import { mkdir, readFile, appendFile, open, unlink, stat } from "node:fs/promises";
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
export type FormationAttempt = { scheduledAt: number; attemptedAt: number; errors: string[] };

const dataDir=()=>process.env.SCREENER_DATA_DIR??"/tmp/screener-data";
export const snapshotPath=()=>join(dataDir(),"ranking-snapshots.jsonl");
export const attemptPath=()=>join(dataDir(),"ranking-attempts.jsonl");

function immutableCore(s:Snapshot){const{status:_s,entryPrices:_a,exitPrices:_b,funding:_c,turnover:_d,strategyReturnPct:_e,benchmarkReturnPct:_f,excessReturnPct:_g,...core}=s;return core}

async function readLines<T>(path:string,label:string):Promise<T[]>{
 let text="";
 try{text=await readFile(path,"utf8")}catch(error:any){if(error.code==="ENOENT")return[];throw error}
 const rows:T[]=[],lines=text.split("\n");
 for(let index=0;index<lines.length;index++){const line=lines[index];if(!line.trim())continue;try{rows.push(JSON.parse(line))}catch{throw new Error(`Corrupt ${label} JSONL at line ${index+1}`)}}
 return rows;
}

export async function readSnapshots(path=snapshotPath()){const latest=new Map<string,Snapshot>();for(const event of await readLines<Snapshot>(path,"ranking"))latest.set(event.key,event);return Array.from(latest.values()).sort((a,b)=>a.scheduledAt-b.scheduledAt)}

const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const STALE_LOCK_MS=30_000;
/** Exclusive-create lock with mtime-based reclaim so a crashed request cannot wedge the ledger. */
async function acquire(lock:string){
 await mkdir(dirname(lock),{recursive:true});
 for(let i=0;i<200;i++){
  try{return await open(lock,"wx")}
  catch(error:any){
   if(error.code!=="EEXIST")throw error;
   try{const info=await stat(lock);if(Date.now()-info.mtimeMs>STALE_LOCK_MS)await unlink(lock).catch(()=>{})}catch{/* lock vanished; retry */}
   await pause(10);
  }
 }
 throw new Error("Snapshot ledger lock timeout");
}

async function withLock<T>(path:string,work:()=>Promise<T>){const lock=`${path}.lock`,handle=await acquire(lock);try{return await work()}finally{await handle.close();await unlink(lock).catch(()=>{})}}

/** Append-only ledger. OPEN may transition once to RESOLVED; formation fields never change. */
export async function appendSnapshot(snapshot:Snapshot,path=snapshotPath()){
 if(snapshot.status==="OPEN"&&(!snapshot.dataQuality.complete||snapshot.universe.length!==16))throw new Error("Incomplete snapshot cannot OPEN");
 return withLock(path,async()=>{
  const old=(await readSnapshots(path)).find(x=>x.key===snapshot.key);
  if(old){
   if(JSON.stringify(old)===JSON.stringify(snapshot))return{created:false,snapshot:old};
   const valid=old.status==="OPEN"&&snapshot.status==="RESOLVED"&&JSON.stringify(immutableCore(old))===JSON.stringify(immutableCore(snapshot));
   if(!valid)throw new Error("Immutable snapshot conflict");
  }
  await mkdir(dirname(path),{recursive:true});
  await appendFile(path,JSON.stringify(snapshot)+"\n",{encoding:"utf8",flag:"a"});
  return{created:true,snapshot};
 });
}

/**
 * Failed formation attempts are recorded outside the immutable snapshot ledger so a
 * transient upstream failure never blocks a legitimate OPEN later in the same window.
 * They become one immutable INVALID observation once the window has elapsed.
 */
export async function recordAttempt(attempt:FormationAttempt,path=attemptPath()){
 return withLock(path,async()=>{await mkdir(dirname(path),{recursive:true});await appendFile(path,JSON.stringify(attempt)+"\n",{encoding:"utf8",flag:"a"});return attempt});
}
export async function readAttempts(path=attemptPath()){return readLines<FormationAttempt>(path,"attempts")}
