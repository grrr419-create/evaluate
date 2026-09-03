import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,call} from './helpers.mjs';
import {fixtureAdmin} from './fixtures.mjs';

test('device migration preserves answers and repeat protection, removes nicknames, and permits participation after reset',async()=>{
 const db=await database({version:4});try{
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;
  const device='a'.repeat(64),answers={'question-a':0,'question-b':1};
  const original=(await call(db,'/api/evaluate/login',{nickname:'기존닉네임',device})).data.session;
  let view=(await call(db,'/api/evaluate/session',{},original)).data;
  await call(db,'/api/evaluate/acknowledge',{notice_version:view.notice_version},original);
  assert.equal((await call(db,'/api/evaluate/submit',{answers,epoch:view.epoch,assessment_version:view.assessment_version},original)).status,200);
  const before=(await call(db,'/api/admin/dashboard',{},admin)).data;
  const migration=await readFile(new URL('../supabase/migrations/202609030005_device_participation.sql',import.meta.url),'utf8');
  await db.exec(migration);
  assert.deepEqual((await call(db,'/api/admin/dashboard',{},admin)).data,before);
  const exported=(await call(db,'/api/admin/export',{},admin)).data;
  assert.deepEqual(exported.responses,[{answers}]);
  const columns=(await db.query("select column_name from information_schema.columns where table_schema='evaluate_private'")).rows;
  assert.equal(columns.some(c=>c.column_name.includes('nickname')),false);
  assert.equal((await call(db,'/api/evaluate/session',{},original)).data.complete,true);
  const blocked=await call(db,'/api/evaluate/login',{device});
  assert.equal(blocked.status,409);assert.equal(blocked.data.error,'평가는 기기 당 1회 참여할 수 있습니다.');
  // A stale client sending any nickname is also identified solely by device.
  assert.equal((await call(db,'/api/evaluate/login',{nickname:'바꾼이름',device})).status,409);
  const other=(await call(db,'/api/evaluate/login',{nickname:'기존닉네임',device:'b'.repeat(64)}));
  assert.equal(other.status,200);
  await db.exec(migration);
  assert.deepEqual((await call(db,'/api/admin/export',{},admin)).data,exported);
  const token=(await call(db,'/api/admin/reset-preview',{},admin)).data.token;
  assert.equal((await call(db,'/api/admin/reset',{token,confirmation:'정말로 초기화 하시겠습니까?'},admin)).status,200);
  assert.equal((await call(db,'/api/evaluate/session',{},other.data.session)).status,401);
  const next=(await call(db,'/api/evaluate/login',{device}));assert.equal(next.status,200);
  view=(await call(db,'/api/evaluate/session',{},next.data.session)).data;
  assert.equal(view.complete,false);assert.equal('nickname' in view,false);
  await call(db,'/api/evaluate/acknowledge',{notice_version:view.notice_version},next.data.session);
  assert.equal((await call(db,'/api/evaluate/submit',{answers,epoch:view.epoch,assessment_version:view.assessment_version},next.data.session)).status,200);
 }finally{await db.close();}
});
