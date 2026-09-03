import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {database,call} from './helpers.mjs';import {fixtureAdmin} from './fixtures.mjs';
test('deployed API uses explicit DELETE/UPDATE predicates required by PostgREST safeupdate',async()=>{
 const db=await database();try{
  const sql=(await db.query("select prosrc from pg_proc where oid='public.evaluate_api(text,jsonb,text,text)'::regprocedure")).rows[0].prosrc;
  const writes=sql.match(/\b(?:delete\s+from|update)\s+evaluate_private\.[^;]+;/gi);
  assert.ok(writes.length>10);
  for(const statement of writes)assert.match(statement,/\bwhere\b/i,statement);
  assert.equal(/safeupdate\.enabled|next_name/.test(sql),false);
 }finally{await db.close();}
});
test('reset removes upgraded aggregate-only data and ignores retired assessment-name input',async()=>{
 const db=await database();try{
  // The original live submissions had aggregates only; include that case as well as admissions.
  await db.exec("update evaluate_private.settings set legacy_count=1,assessment_name='obsolete name' where singleton; insert into evaluate_private.legacy_counts values('question-a',0,1),('question-b',1,1);");
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;
  const first=await call(db,'/api/evaluate/login',{nickname:'검증용바람',device:'1'.repeat(64)});
  assert.equal(first.status,200);
  const before=(await call(db,'/api/admin/dashboard',{},admin)).data;assert.equal(before.completed,1);
  const token=(await call(db,'/api/admin/reset-preview',{},admin)).data.token;
  const reset=await call(db,'/api/admin/reset',{token,confirmation:'정말로 초기화 하시겠습니까?',name:'ignored legacy client field'},admin);
  assert.equal(reset.status,200);
  const after=(await call(db,'/api/admin/dashboard',{},admin)).data;
  assert.equal(after.completed,0);assert.equal(after.name,'업무환경 심리평가');assert.notEqual(after.epoch,before.epoch);
  assert.equal((await call(db,'/api/evaluate/session',{},first.data.session)).status,401);
  assert.equal((await call(db,'/api/admin/export',{},admin)).status,403);
  const migration=await readFile(new URL('../supabase/migrations/202609030004_reset_conditions.sql',import.meta.url),'utf8');
  await db.exec(migration);assert.equal((await call(db,'/api/admin/dashboard',{},admin)).data.epoch,after.epoch);
 }finally{await db.close();}
});
