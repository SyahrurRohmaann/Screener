import test from "node:test";import assert from "node:assert/strict";
import {mkdtemp,rm,readFile,writeFile} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
import {IDLE_TIMEOUT_MS,SESSION_COOKIE,authState,login,logout,changePassword,readSession,sessionCookie,clearedCookie,recordFailure,loginLocked} from "./auth";

async function withDataDir<T>(work:(dir:string)=>Promise<T>){
  const dir=await mkdtemp(join(tmpdir(),"auth-"));const previous=process.env.SCREENER_DATA_DIR;
  process.env.SCREENER_DATA_DIR=dir;
  try{return await work(dir)}finally{
    if(previous===undefined)delete process.env.SCREENER_DATA_DIR;else process.env.SCREENER_DATA_DIR=previous;
    await rm(dir,{recursive:true,force:true});
  }
}

test("the initial password is seeded as a salted hash and never stored in plaintext",async()=>{
  await withDataDir(async(dir)=>{
    const state=await authState();
    assert.equal(state.passwordVersion,1);
    assert.ok(state.salt.length>=32);
    assert.ok(state.hash.length>=64);
    const raw=await readFile(join(dir,"auth.json"),"utf8");
    assert.equal(raw.includes("098123plm"),false);
    assert.equal(JSON.parse(raw).password,undefined);
  });
});

test("login accepts the initial password, rejects wrong ones, and issues an opaque session",async()=>{
  await withDataDir(async()=>{
    assert.equal(await login("wrong"),null);
    const session=await login("098123plm");
    assert.ok(session&&session.id.length>=32);
    assert.notEqual(session.id,"098123plm");
    const cookie = sessionCookie(session.id,false);
    assert.match(cookie,/HttpOnly/);
    assert.match(cookie,/SameSite=Lax/);
    assert.match(cookie,new RegExp(`^${SESSION_COOKIE}=`));
    assert.equal(cookie.includes("Secure"),false);
    assert.match(sessionCookie(session.id,true),/Secure/);
    assert.match(cookie,/Max-Age=7200/);
  });
});

test("a session expires after two hours without activity and its cookie is cleared",async()=>{
  await withDataDir(async()=>{
    assert.equal(IDLE_TIMEOUT_MS,2*60*60*1000);
    const start=Date.now();
    const nearly=(await login("098123plm"))!;
    assert.ok(await readSession(nearly.id,start+IDLE_TIMEOUT_MS-60_000));
    const stale=(await login("098123plm"))!;
    assert.equal(await readSession(stale.id,start+IDLE_TIMEOUT_MS+60_000),null);
    assert.match(clearedCookie(false),/Max-Age=0/);
  });
});

test("activity slides the idle window forward instead of using a fixed lifetime",async()=>{
  await withDataDir(async()=>{
    const start=Date.now();
    // Sliding: used at +90m, so still valid at +180m even though a fixed 2h lifetime would have expired.
    const sliding=(await login("098123plm"))!;
    assert.ok(await readSession(sliding.id,start+90*60_000));
    assert.ok(await readSession(sliding.id,start+180*60_000));
    // Idle: last used at +90m and untouched since, so dead just past +90m+2h.
    const idle=(await login("098123plm"))!;
    assert.ok(await readSession(idle.id,start+90*60_000));
    assert.equal(await readSession(idle.id,start+90*60_000+IDLE_TIMEOUT_MS+60_000),null);
  });
});

test("an unknown or tampered session id is rejected",async()=>{
  await withDataDir(async()=>{
    await login("098123plm");
    assert.equal(await readSession("not-a-real-session"),null);
    assert.equal(await readSession(""),null);
  });
});

test("logout invalidates only that session",async()=>{
  await withDataDir(async()=>{
    const a=(await login("098123plm"))!,b=(await login("098123plm"))!;
    await logout(a.id);
    assert.equal(await readSession(a.id),null);
    assert.ok(await readSession(b.id));
  });
});

test("changing the password requires the current one and logs out every other session",async()=>{
  await withDataDir(async()=>{
    const current=(await login("098123plm"))!,other=(await login("098123plm"))!;
    await assert.rejects(()=>changePassword("wrong","longenoughpassword",current.id),/salah/i);
    await assert.rejects(()=>changePassword("098123plm","short",current.id),/minimal/i);
    const result=await changePassword("098123plm","rahasia-baru-panjang",current.id);
    assert.equal(result.passwordVersion,2);
    assert.ok(await readSession(current.id));
    assert.equal(await readSession(other.id),null);
    assert.equal(await login("098123plm"),null);
    assert.ok(await login("rahasia-baru-panjang"));
  });
});

test("repeated failed logins lock the login for a while",async()=>{
  await withDataDir(async()=>{
    const now=Date.now();
    assert.equal(await loginLocked(now),false);
    for(let i=0;i<10;i++)await recordFailure(now+i);
    assert.equal(await loginLocked(now+10),true);
    assert.equal(await login("098123plm",now+10),null);
    assert.equal(await loginLocked(now+20*60_000),false);
  });
});

test("a corrupt auth file fails closed instead of silently resetting the password",async()=>{
  await withDataDir(async(dir)=>{
    await writeFile(join(dir,"auth.json"),"{not json");
    await assert.rejects(()=>authState(),/corrupt/i);
  });
});
