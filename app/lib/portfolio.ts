export function compound(start:number,returns:number[]){return returns.reduce((e,r)=>e*(1+r),start)}
export function equalWeightReturn(returns:number[]){return returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0}
export function turnover(previous:string[],next:string[]){if(!previous.length)return 1;const sells=previous.filter(x=>!next.includes(x)).length,nextBuys=next.filter(x=>!previous.includes(x)).length;return (sells+nextBuys)/next.length}
export function fundingReturn(settlements:{rate:number;mark:number}[],entry:number){return -settlements.reduce((x,s)=>x+s.rate*s.mark/entry,0)}
export function maxDrawdown(equity:number[]){let peak=equity[0]??0,dd=0;for(const x of equity){peak=Math.max(peak,x);if(peak)dd=Math.max(dd,(peak-x)/peak)}return dd}
export function weeklyReturn(legReturns:number[],funding=0,turnoverValue=0,feePct=0){return equalWeightReturn(legReturns)+funding-turnoverValue*feePct}

export function resolvePaperSnapshot(input:{universe:string[];top4:string[];previousTop4:string[];previousUniverse:string[];entryPrices:Record<string,number>;exitPrices:Record<string,number>;funding:Record<string,number>;roundTripCostPct:number}){
 const gross=(coin:string)=>100*(input.exitPrices[coin]/input.entryPrices[coin]-1);
 const strategyGross=equalWeightReturn(input.top4.map(gross));
 const benchmarkGross=equalWeightReturn(input.universe.map(gross));
 const strategyFunding=equalWeightReturn(input.top4.map(c=>input.funding[c]??0));
 const benchmarkFunding=equalWeightReturn(input.universe.map(c=>input.funding[c]??0));
 // Both books pay the same cost rule on their own membership changes: a full charge to
 // establish the first position, then only actual turnover. Never charge the benchmark
 // a weekly round trip it does not make, and never let the strategy trade for free.
 const turnoverValue=turnover(input.previousTop4,input.top4);
 const benchmarkTurnover=turnover(input.previousUniverse,input.universe);
 const strategyReturnPct=strategyGross+strategyFunding-input.roundTripCostPct*turnoverValue;
 const benchmarkReturnPct=benchmarkGross+benchmarkFunding-input.roundTripCostPct*benchmarkTurnover;
 return{strategyReturnPct,benchmarkReturnPct,excessReturnPct:strategyReturnPct-benchmarkReturnPct,turnover:turnoverValue};
}
