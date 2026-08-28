import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_UNIVERSE, rankUniverse, type RankingMarket } from "./ranking";

const H4=14_400_000, END=1_800_000_000_000;
function market(symbol:string, factor=1, end=END, n=1000):RankingMarket {
  return {symbol, candles:Array.from({length:n},(_,i)=>({closeTime:end-(n-1-i)*H4,close:(100+i)*factor}))};
}
test("14-day return uses closed i and i-84 and deterministically ranks all 16",()=>{
  const markets=FIXED_UNIVERSE.map((s,i)=>market(s,1+i/100));
  // Scale cancels, then create distinct final returns.
  markets.forEach((m,i)=>m.candles[m.candles.length-1].close*=1+i/100);
  const r=rankUniverse(markets,END);
  assert.equal(r.status,"COMPLETE");
  if(r.status!=="COMPLETE") return;
  const btc=markets.find(x=>x.symbol==="BTC")!;
  assert.equal(r.lookbackReturns.BTC,btc.candles.at(-1)!.close/btc.candles.at(-85)!.close-1);
  assert.deepEqual(r.top4,["ETC","FIL","NEAR","ATOM"]);
});
test("tie breaks alphabetically and breadth is continuous context",()=>{
 const r=rankUniverse(FIXED_UNIVERSE.map(s=>market(s)),END);
 assert.equal(r.status,"COMPLETE"); if(r.status!=="COMPLETE")return;
 assert.deepEqual(r.ranking,[...FIXED_UNIVERSE].sort()); assert.equal(r.breadth,1);
});
test("in-progress candles are excluded without dropping latest closed candle",()=>{
 const xs=FIXED_UNIVERSE.map(s=>{const m=market(s);m.candles.push({closeTime:END+H4,close:999999});return m});
 const r=rankUniverse(xs,END); assert.equal(r.status,"COMPLETE"); if(r.status==="COMPLETE") assert.equal(r.dataAsOf,END);
});
test("requires fixed 16, 1000-bar warmup, and aligned timestamps",()=>{
 assert.equal(rankUniverse(FIXED_UNIVERSE.slice(1).map(s=>market(s)),END).status,"INCOMPLETE");
 const short=FIXED_UNIVERSE.map(s=>market(s)); short[0]=market("BTC",1,END,999);
 assert.equal(rankUniverse(short,END).status,"INCOMPLETE");
 const skew=FIXED_UNIVERSE.map(s=>market(s)); skew[0]=market("BTC",1,END-H4);
 assert.equal(rankUniverse(skew,END).status,"INCOMPLETE");
});

test("effective close must itself be closed and shared",()=>{
 const r=rankUniverse(FIXED_UNIVERSE.map(s=>market(s)),END+H4);
 assert.equal(r.status,"INCOMPLETE");
});
