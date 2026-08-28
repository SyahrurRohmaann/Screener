import { ema } from "./indicators";

export const FIXED_UNIVERSE = ["BTC","ETH","SOL","XRP","BNB","DOGE","ADA","AVAX","LINK","DOT","LTC","TRX","ATOM","NEAR","FIL","ETC"] as const;
export const LOOKBACK_BARS=84, MIN_BARS=1000;
export type RankingMarket={symbol:string;candles:{closeTime:number;close:number;open?:number}[]};
export type RankingComplete={status:"COMPLETE";dataAsOf:number;ranking:string[];top4:string[];lookbackReturns:Record<string,number>;breadth:number;ema200:Record<string,number>;signalPrices:Record<string,number>};
export type RankingResult=RankingComplete|{status:"INCOMPLETE";errors:string[]};

export function rankUniverse(markets:RankingMarket[],effectiveCloseAt:number):RankingResult{
 const errors:string[]=[]; const map=new Map(markets.map(m=>[m.symbol,m]));
 if(markets.length!==16||FIXED_UNIVERSE.some(s=>!map.has(s))||markets.some(m=>!FIXED_UNIVERSE.includes(m.symbol as typeof FIXED_UNIVERSE[number]))) errors.push("Fixed universe must be complete 16/16");
 const selected:Record<string,RankingMarket["candles"]>={};
 for(const symbol of FIXED_UNIVERSE){const m=map.get(symbol);if(!m)continue; const closed=m.candles.filter(c=>c.closeTime<=effectiveCloseAt);selected[symbol]=closed;if(closed.length<MIN_BARS)errors.push(`${symbol}: needs ${MIN_BARS} closed bars`);else if(closed.at(-1)!.closeTime!==effectiveCloseAt)errors.push(`${symbol}: stale or misaligned`);}
 if(errors.length)return {status:"INCOMPLETE",errors};
 const lookbackReturns:Record<string,number>={},ema200:Record<string,number>={},signalPrices:Record<string,number>={};let above=0;
 for(const s of FIXED_UNIVERSE){const c=selected[s];const closes=c.map(x=>x.close),last=closes.at(-1)!;lookbackReturns[s]=last/closes.at(-(LOOKBACK_BARS+1))!-1;ema200[s]=ema(closes,200).at(-1)!;signalPrices[s]=last;if(last>ema200[s])above++;}
 const ranking=[...FIXED_UNIVERSE].sort((a,b)=>lookbackReturns[b]-lookbackReturns[a]||a.localeCompare(b));
 return {status:"COMPLETE",dataAsOf:effectiveCloseAt,ranking,top4:ranking.slice(0,4),lookbackReturns,breadth:above/16,ema200,signalPrices};
}
