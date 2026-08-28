import { mkdir, readFile, appendFile, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SnapshotStatus = "OPEN" | "RESOLVED" | "MISSED" | "INVALID";
export type Snapshot = {
  schemaVersion: 1; key: string; specHash: string; status: SnapshotStatus;
  scheduledAt: number; formedAt: number; dataAsOf: number; entryAt: number; exitAt: number;
  universe: string[]; lookbackReturns: Record<string, number>; ranking: string[];
  top4: string[]; breadth: number; ema200: Record<string, number>;
  signalPrices: Record<string, number>; entryPrices?: Record<string, number>;
  exitPrices?: Record<string, number>; funding?: Record<string, number>;
  turnover?: number; strategyReturnPct?: number; benchmarkReturnPct?: number;
  excessReturnPct?: number; dataQuality: { complete: boolean; errors: string[] };
};

export const snapshotPath=()=>join(process.env.SCREENER_DATA_DIR??"/tmp/screener-data","ranking-snapshots.jsonl");
function immutableCore(s:Snapshot){const{status:_s,entryPrices:_a,exitPrices:_b,funding:_c,turnover:_d,strategyReturnPct:_e,benchmarkReturnPct:_f,excessReturnPct:_g,...core}=s;return core}
async function readEvents(path:string){let text="";try{text=await readFile(path,"utf8")}catch(error:any){if(error.code==="ENOENT")return[];throw error}const events:Snapshot[]=[],lines=text.split("\n");for(let index=0;index<lines.length;index++){const line=lines[index];if(!line.trim())continue;try{events.push(JSON.parse(line))}catch{throw new Error(`Corrupt ranking JSONL at line ${index+1}`)}}return events}
export async function readSnapshots(path=snapshotPath()){const latest=new Map<string,Snapshot>();for(const event of await readEvents(path))latest.set(event.key,event);return Array.from(latest.values()).sort((a,b)=>a.scheduledAt-b.scheduledAt)}

const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function acquire(lock:string){await mkdir(dirname(lock),{recursive:true});for(let i=0;i<100;i++){try{return await open(lock,"wx")}catch(error:any){if(error.code!=="EEXIST")throw error;await pause(10)}}throw new Error("Snapshot ledger lock timeout")}

/** Cross-request/process lock protects read-check-append as one critical section. */
export async function appendSnapshot(snapshot:Snapshot,path=snapshotPath()){
 if(snapshot.status==="OPEN"&&(!snapshot.dataQuality.complete||snapshot.universe.length!==16))throw new Error("Incomplete snapshot cannot OPEN");
 const lock=`${path}.lock`,handle=await acquire(lock);
 try{
  const old=(await readSnapshots(path)).find(x=>x.key===snapshot.key);
  if(old){if(JSON.stringify(old)===JSON.stringify(snapshot))return{created:false,snapshot:old};const valid=old.status==="OPEN"&&snapshot.status==="RESOLVED"&&JSON.stringify(immutableCore(old))===JSON.stringify(immutableCore(snapshot));if(!valid)throw new Error("Immutable snapshot conflict")}
  await mkdir(dirname(path),{recursive:true});await appendFile(path,JSON.stringify(snapshot)+"\n",{encoding:"utf8",flag:"a"});return{created:true,snapshot};
 }finally{await handle.close();await unlink(lock).catch(()=>{})}
}
