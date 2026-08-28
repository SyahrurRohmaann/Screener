import { createHash } from "node:crypto";
import { FIXED_UNIVERSE, rankUniverse } from "./ranking";
import { fetchRankingMarkets, FORMATION_WINDOW_MS, latestClosed4h, schedule } from "./ranking-data";
import { appendSnapshot, readSnapshots, recordAttempt, readAttempts, type Snapshot } from "./ranking-store";
import { resolvePaperSnapshot } from "./portfolio";
import { BINANCE, type Candle } from "./indicators";

export const SPEC_HASH = "02abfad675d23211de4af3f39c5bc011f465e5926a1337f635d178539d6ef48a";
const ROUND_TRIP_COST_PCT = Number(process.env.RANKING_ROUND_TRIP_COST_PCT ?? .14);

export function isoWeek(ms:number){const d=new Date(ms),x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));x.setUTCDate(x.getUTCDate()+4-(x.getUTCDay()||7));const y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return `${x.getUTCFullYear()}-W${String(Math.ceil((((x.getTime()-y.getTime())/86400000)+1)/7)).padStart(2,"0")}`}
export function snapshotKey(at:number,hash=SPEC_HASH){return `${isoWeek(at)}-${hash.slice(0,12)}`}
/** Fail-closed: a configured token plus a same-origin request are both required. */
export function requestAllowed(req:Request){
 const origin=req.headers.get("origin"),host=req.headers.get("host"),token=process.env.RANKING_SNAPSHOT_TOKEN;
 if(!token||!origin||!host)return false;
 try{if(new URL(origin).host!==host)return false}catch{return false}
 const presented=req.headers.get("authorization")??"";
 const expected=`Bearer ${token}`;
 if(presented.length!==expected.length)return false;
 let diff=0;
 for(let i=0;i<expected.length;i++)diff|=presented.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
export async function preview(now=Date.now()){const s=schedule(now),effectiveCloseAt=latestClosed4h(now),data=await fetchRankingMarkets(effectiveCloseAt),ranking=rankUniverse(data.markets,effectiveCloseAt);return{mode:"PREVIEW_LIVE",...s,effectiveCloseAt,...data,ranking,specHash:SPEC_HASH}}
export async function formSnapshot(now=Date.now()){
 const s=schedule(now);
 if(now<s.scheduledAt||now>s.scheduledAt+FORMATION_WINDOW_MS)throw new Error("Outside bounded formation window; missed weeks cannot be backfilled");
 const data=await fetchRankingMarkets(s.effectiveCloseAt),ranking=rankUniverse(data.markets,s.effectiveCloseAt);
 if(!data.complete||ranking.status!=="COMPLETE"){
  // A failed attempt is logged outside the immutable ledger so a retry inside the same
  // window can still form a legitimate OPEN snapshot once upstream data recovers.
  const errors=[...data.errors,...(ranking.status==="INCOMPLETE"?ranking.errors:[])];
  await recordAttempt({scheduledAt:s.scheduledAt,attemptedAt:now,errors});
  throw new Error(`INCOMPLETE: ${errors.join("; ")}`);
 }
 const r=ranking;
 const snap:Snapshot={schemaVersion:1,key:snapshotKey(s.scheduledAt),specHash:SPEC_HASH,status:"OPEN",scheduledAt:s.scheduledAt,formedAt:now,dataAsOf:r.dataAsOf,entryAt:s.entryAt,exitAt:s.exitAt,universe:[...FIXED_UNIVERSE],lookbackReturns:r.lookbackReturns,ranking:r.ranking,top4:r.top4,breadth:r.breadth,ema200:r.ema200,signalPrices:r.signalPrices,dataQuality:{complete:true,errors:[]}};
 return appendSnapshot(snap);
}

async function priceAtOpen(symbol:string,at:number,fetcher:typeof fetch){const url=`${BINANCE}/fapi/v1/klines?symbol=${symbol}USDT&interval=4h&startTime=${at}&limit=1`;const r=await fetcher(url,{cache:"no-store",signal:AbortSignal.timeout(10_000)});if(!r.ok)throw new Error(`${symbol} open HTTP ${r.status}`);const rows=await r.json() as Candle[];const price=Number(rows[0]?.[1]);if(!rows.length||Number(rows[0][0])!==at||!Number.isFinite(price)||price<=0)throw new Error(`${symbol}: valid exact 4h open unavailable at ${at}`);return price}
async function fundingPct(symbol:string,start:number,end:number,entry:number,fetcher:typeof fetch){const url=`${BINANCE}/fapi/v1/fundingRate?symbol=${symbol}USDT&startTime=${start}&endTime=${end-1}&limit=1000`;const r=await fetcher(url,{cache:"no-store",signal:AbortSignal.timeout(10_000)});if(!r.ok)throw new Error(`${symbol} funding HTTP ${r.status}`);const rows=await r.json() as {fundingRate:string;markPrice:string}[];let total=0;for(const x of rows){const rate=Number(x.fundingRate),mark=Number(x.markPrice);if(!Number.isFinite(rate)||!Number.isFinite(mark)||mark<=0)throw new Error(`${symbol}: invalid funding settlement`);total+=rate*mark/entry}return -100*total}

export async function resolveOpenSnapshots(now=Date.now(),fetcher:typeof fetch=fetch){const rows=await readSnapshots();for(let index=0;index<rows.length;index++){const open=rows[index];if(open.status!=="OPEN"||open.exitAt>now)continue;try{const entryPrices:Record<string,number>={},exitPrices:Record<string,number>={},funding:Record<string,number>={};for(let i=0;i<open.universe.length;i+=4){await Promise.all(open.universe.slice(i,i+4).map(async symbol=>{entryPrices[symbol]=await priceAtOpen(symbol,open.entryAt,fetcher);exitPrices[symbol]=await priceAtOpen(symbol,open.exitAt,fetcher);funding[symbol]=await fundingPct(symbol,open.entryAt,open.exitAt,entryPrices[symbol],fetcher)}))}const prior=[...rows].slice(0,index).reverse().find(x=>x.status==="RESOLVED");const result=resolvePaperSnapshot({universe:open.universe,top4:open.top4,previousTop4:prior?.top4??[],previousUniverse:prior?.universe??[],entryPrices,exitPrices,funding,roundTripCostPct:ROUND_TRIP_COST_PCT});await appendSnapshot({...open,status:"RESOLVED",entryPrices,exitPrices,funding,...result})}catch{/* Keep OPEN and retry on a later request; never invent fills. */}}
}

/**
 * After a formation window has elapsed without an OPEN snapshot, close the week once and
 * immutably: INVALID when formation was attempted but the data was incomplete, MISSED when
 * no attempt was made at all. Weeks before the first ledger row are never backfilled.
 */
export async function recordMissed(now=Date.now()){
 const current=schedule(now),week=604_800_000;
 const existing=await readSnapshots(),attempts=await readAttempts();
 // Start at the week after the last closed observation; with an empty ledger, start at the
 // earliest attempted week so a failed formation is still closed as INVALID.
 let at=existing.length
  ? Math.max(...existing.map(x=>x.scheduledAt))+week
  : attempts.length ? Math.min(...attempts.map(x=>x.scheduledAt)) : current.scheduledAt;
 const keys=new Set(existing.map(x=>x.key));
 for(;at<=current.scheduledAt;at+=week){
  if(now<=at+FORMATION_WINDOW_MS)continue;
  const key=snapshotKey(at);
  if(keys.has(key))continue;
  const failed=attempts.filter(x=>x.scheduledAt===at);
  const empty=Object.fromEntries(FIXED_UNIVERSE.map(x=>[x,0]));
  await appendSnapshot({schemaVersion:1,key,specHash:SPEC_HASH,status:failed.length?"INVALID":"MISSED",scheduledAt:at,formedAt:now,dataAsOf:at-1,entryAt:at,exitAt:at+week,universe:[...FIXED_UNIVERSE],lookbackReturns:{},ranking:[],top4:[],breadth:0,ema200:empty,signalPrices:empty,dataQuality:{complete:false,errors:failed.length?failed.flatMap(x=>x.errors):["Formation window elapsed without a formation attempt"]}});
  keys.add(key);
 }
}
export async function history(now=Date.now()){await recordMissed(now);await resolveOpenSnapshots(now);const rows=await readSnapshots();return{snapshots:rows,stats:(await import("./forward-stats")).summarizeForward(rows),specHash:SPEC_HASH}}
export function canonicalHash(text:string){return createHash("sha256").update(text).digest("hex")}
