import { BINANCE, type Candle } from "./indicators";
import { FIXED_UNIVERSE, type RankingMarket } from "./ranking";

const H4=14_400_000, WEEK=604_800_000;
export const FORMATION_WINDOW_MS=30*60_000;

export function schedule(now=Date.now()) {
  const d=new Date(now),day=(d.getUTCDay()+6)%7;
  let scheduledAt=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day,8);
  if(now<scheduledAt)scheduledAt-=WEEK;
  return{scheduledAt,effectiveCloseAt:scheduledAt-1,nextRebalanceAt:scheduledAt+WEEK,entryAt:scheduledAt,exitAt:scheduledAt+WEEK};
}

async function page(symbol:string,endTime:number,fetcher:typeof fetch){
  const url=`${BINANCE}/fapi/v1/klines?symbol=${symbol}USDT&interval=4h&limit=1000&endTime=${endTime}`;
  const r=await fetcher(url,{cache:"no-store",signal:AbortSignal.timeout(10_000)});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return await r.json() as Candle[];
}

async function one(symbol:string,effective:number,fetcher:typeof fetch,retries=2){
  let error="";
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      let raw=await page(symbol,effective,fetcher);
      const eligible=()=>raw.filter(x=>Number(x[6])<=effective);
      if(eligible().length<1000&&raw.length){
        const oldestOpen=Number(raw[0][0]);
        raw=[...(await page(symbol,oldestOpen-1,fetcher)),...raw];
      }
      const dedup=new Map<number,{closeTime:number;close:number;open:number}>();
      for(const x of eligible())dedup.set(Number(x[6]),{closeTime:Number(x[6]),close:Number(x[4]),open:Number(x[1])});
      const candles=Array.from(dedup.values()).sort((a,b)=>a.closeTime-b.closeTime).slice(-1000);
      return{market:{symbol,candles} as RankingMarket};
    }catch(e){error=e instanceof Error?e.message:String(e)}
  }
  return{error:`${symbol}: ${error}`};
}

export async function fetchRankingMarkets(effective:number,fetcher:typeof fetch=fetch){
  const markets:RankingMarket[]=[],errors:string[]=[];
  for(let i=0;i<FIXED_UNIVERSE.length;i+=4){
    const batch=await Promise.all(FIXED_UNIVERSE.slice(i,i+4).map(s=>one(s,effective,fetcher)));
    for(const x of batch)x.market?markets.push(x.market):errors.push(x.error!);
  }
  const ends=markets.map(x=>x.candles.at(-1)?.closeTime);
  if(markets.length!==16)errors.push(`Only ${markets.length}/16 markets available`);
  if(ends.some(x=>x!==effective))errors.push("Stale or misaligned effective close");
  if(markets.some(x=>x.candles.length<1000))errors.push("Fewer than 1000 closed 4h bars");
  const s=schedule(effective+1);
  return{complete:errors.length===0,markets,errors,dataAsOf:effective,effectiveRebalanceAt:s.scheduledAt,nextRebalanceAt:s.nextRebalanceAt};
}
