import test from "node:test";import assert from "node:assert/strict";
import {mkdtemp,rm,writeFile,readFile} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
import {formSnapshot,recordMissed,requestAllowed,preview,canonicalHash,SPEC_HASH} from "./ranking-lifecycle";
import {readSnapshots,readAttempts,appendSnapshot,type Snapshot} from "./ranking-store";
import {latestClosed4h} from "./ranking-data";

const H4=14_400_000,WEEK=604_800_000,MONDAY=Date.UTC(2026,7,31,8);
const bars=(effective:number,count=1000)=>Array.from({length:count},(_,i)=>[0,"1","1","1",String(100+i),"1",effective-(count-1-i)*H4]);
const ok=(effective:number,count=1000)=>async()=>new Response(JSON.stringify(bars(effective,count)));

async function withDataDir<T>(work:(dir:string)=>Promise<T>){
  const dir=await mkdtemp(join(tmpdir(),"life-"));const previous=process.env.SCREENER_DATA_DIR;
  process.env.SCREENER_DATA_DIR=dir;
  try{return await work(dir)}finally{
    if(previous===undefined)delete process.env.SCREENER_DATA_DIR;else process.env.SCREENER_DATA_DIR=previous;
    await rm(dir,{recursive:true,force:true});
  }
}
async function withFetch<T>(fetcher:any,work:()=>Promise<T>){
  const previous=globalThis.fetch;globalThis.fetch=fetcher;
  try{return await work()}finally{globalThis.fetch=previous}
}
const req=(headers:Record<string,string>)=>new Request("http://host.test/api/ranking/snapshot",{method:"POST",headers:{Host:"host.test",...headers}});

test("the frozen canonical spec block still hashes to the published SPEC_HASH",async()=>{
  const text=await readFile(new URL("../../SPEC-XSMOM-FORWARD.md",import.meta.url),"utf8");
  const body=text.split("<!-- BEGIN CANONICAL -->")[1].split("<!-- END CANONICAL -->")[0];
  assert.equal(canonicalHash(body.trim()+"\n"),SPEC_HASH);
});

test("snapshot mutation fails closed without a configured token and same-origin request",()=>{
  const previous=process.env.RANKING_SNAPSHOT_TOKEN;
  try{
    delete process.env.RANKING_SNAPSHOT_TOKEN;
    assert.equal(requestAllowed(req({Origin:"http://host.test",Authorization:"Bearer anything"})),false);
    process.env.RANKING_SNAPSHOT_TOKEN="secret";
    assert.equal(requestAllowed(req({Origin:"http://host.test"})),false);
    assert.equal(requestAllowed(req({Origin:"http://host.test",Authorization:"Bearer wrong0"})),false);
    assert.equal(requestAllowed(req({Origin:"http://evil.test",Authorization:"Bearer secret"})),false);
    assert.equal(requestAllowed(req({Authorization:"Bearer secret"})),false);
    assert.equal(requestAllowed(req({Origin:"http://host.test",Authorization:"Bearer secret"})),true);
  }finally{if(previous===undefined)delete process.env.RANKING_SNAPSHOT_TOKEN;else process.env.RANKING_SNAPSHOT_TOKEN=previous}
});

test("a transient formation failure is logged outside the ledger and never blocks a retry in the same window",async()=>{
  await withDataDir(async()=>{
    const now=MONDAY+60_000,effective=MONDAY-1;
    await withFetch(ok(effective,500),async()=>{await assert.rejects(()=>formSnapshot(now),/INCOMPLETE/)});
    assert.equal((await readSnapshots()).length,0);
    assert.equal((await readAttempts()).length,1);
    const created=await withFetch(ok(effective),()=>formSnapshot(now+120_000));
    assert.equal(created.created,true);
    const rows=await readSnapshots();
    assert.equal(rows.length,1);assert.equal(rows[0].status,"OPEN");assert.equal(rows[0].universe.length,16);
  });
});

test("formation outside the bounded window is refused and never backfilled",async()=>{
  await withDataDir(async()=>{
    await withFetch(ok(MONDAY-1),async()=>{await assert.rejects(()=>formSnapshot(MONDAY+3*60*60_000),/Outside bounded formation window/)});
    assert.equal((await readSnapshots()).length,0);
  });
});

test("an elapsed window closes as INVALID after a failed attempt and MISSED without one",async()=>{
  await withDataDir(async()=>{
    const now=MONDAY+60_000,effective=MONDAY-1;
    await withFetch(ok(effective,500),async()=>{await assert.rejects(()=>formSnapshot(now),/INCOMPLETE/)});
    await recordMissed(MONDAY+WEEK+60*60_000);
    const rows=await readSnapshots();
    assert.equal(rows[0].status,"INVALID");
    assert.ok(rows[0].dataQuality.errors.length>0);
    assert.equal(rows.at(-1)!.status,"MISSED");
    assert.equal(rows.length,2);
  });
});

test("every elapsed week is closed exactly once and older weeks are never invented",async()=>{
  await withDataDir(async()=>{
    const base:Snapshot={schemaVersion:1,key:"seed",specHash:"x",status:"OPEN",scheduledAt:MONDAY,formedAt:MONDAY,dataAsOf:MONDAY-1,entryAt:MONDAY,exitAt:MONDAY+WEEK,universe:Array.from({length:16},(_,i)=>`C${i}`),lookbackReturns:{},ranking:[],top4:[],breadth:.5,ema200:{},signalPrices:{},dataQuality:{complete:true,errors:[]}};
    await appendSnapshot(base);
    await recordMissed(MONDAY+3*WEEK+60*60_000);
    await recordMissed(MONDAY+3*WEEK+61*60_000);
    const rows=await readSnapshots();
    assert.equal(rows.length,4);
    assert.equal(rows.filter(x=>x.status==="MISSED").length,3);
    assert.ok(rows.every(x=>x.scheduledAt>=MONDAY));
  });
});

test("preview reports the latest closed 4h bar, not the frozen Monday close",async()=>{
  await withDataDir(async()=>{
    const friday=Date.UTC(2026,8,4,13,7),effective=latestClosed4h(friday);
    assert.equal(effective,Date.UTC(2026,8,4,12)-1);
    const p=await withFetch(ok(effective),()=>preview(friday));
    assert.equal(p.complete,true);
    assert.equal(p.effectiveCloseAt,effective);
    assert.notEqual(p.effectiveCloseAt,p.scheduledAt-1);
    assert.equal(p.mode,"PREVIEW_LIVE");
  });
});

test("a stale lock left by a crashed request is reclaimed instead of wedging the ledger",async()=>{
  await withDataDir(async(dir)=>{
    const path=join(dir,"ranking-snapshots.jsonl");
    await writeFile(`${path}.lock`,"");
    const stale=new Date(Date.now()-120_000);
    const {utimes}=await import("node:fs/promises");
    await utimes(`${path}.lock`,stale,stale);
    const snap:Snapshot={schemaVersion:1,key:"k",specHash:"x",status:"OPEN",scheduledAt:MONDAY,formedAt:MONDAY,dataAsOf:MONDAY-1,entryAt:MONDAY,exitAt:MONDAY+WEEK,universe:Array.from({length:16},(_,i)=>`C${i}`),lookbackReturns:{},ranking:[],top4:[],breadth:.5,ema200:{},signalPrices:{},dataQuality:{complete:true,errors:[]}};
    assert.equal((await appendSnapshot(snap,path)).created,true);
    assert.equal((await readFile(path,"utf8")).trim().split("\n").length,1);
  });
});
