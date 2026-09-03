import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {database,call} from './helpers.mjs';
import {fixtureAdmin,legacyFixture} from './fixtures.mjs';
const migrations=new URL('../supabase/migrations/',import.meta.url);
async function submit(db,nickname,n,answers){
 const session=(await call(db,'/api/evaluate/login',{nickname,device:n.toString(16).padStart(64,'0')})).data.session;
 const initial=(await call(db,'/api/evaluate/session',{},session)).data;
 const view=(await call(db,'/api/evaluate/acknowledge',{notice_version:initial.notice_version},session)).data;
 assert.equal((await call(db,'/api/evaluate/submit',{answers,epoch:view.epoch,assessment_version:view.assessment_version},session)).status,200);
 return session;
}
async function legacySubmit(db,id,answers){
 const session=(await call(db,'/api/evaluate/login',{id,password:id})).data.session;
 const view=(await call(db,'/api/evaluate/acknowledge',{notice_version:legacyFixture.notice_version},session)).data;
 assert.equal((await call(db,'/api/evaluate/submit',{answers,epoch:view.epoch,assessment_version:view.assessment_version},session)).status,200);
 return session;
}
async function writer(){
 const context=vm.createContext({TextEncoder});
 vm.runInContext(await readFile(new URL('../public/statistics-excel.js',import.meta.url),'utf8')+'\nthis.makeExcel=StatisticsExcel.create;',context);
 return context.makeExcel;
}
function unzip(bytes){
 const result=new Map(),data=Buffer.from(bytes);let at=0;
 while(data.readUInt32LE(at)===0x04034b50){
  assert.equal(data.readUInt16LE(at+8),0);
  const size=data.readUInt32LE(at+18),nameLength=data.readUInt16LE(at+26),extraLength=data.readUInt16LE(at+28);
  const name=data.subarray(at+30,at+30+nameLength).toString(),start=at+30+nameLength+extraLength;
  result.set(name,data.subarray(start,start+size).toString());at=start+size;
 }
 return result;
}
test('Excel includes separate anonymous answers without names or technical identifiers',async()=>{
 const db=await database();try{
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;
  const first=await submit(db,'바람 <&>',1,{'question-a':0,'question-b':1});
  await submit(db,'=SUM(1,2)',2,{'question-a':1,'question-b':2});
  assert.equal((await call(db,'/api/admin/export',{},first)).status,401);
  const exported=(await call(db,'/api/admin/export',{},admin)).data;
  assert.equal(exported.completed,2);assert.equal(exported.response_count,2);assert.equal(exported.unavailable_response_count,0);
  assert.ok(exported.responses.some(x=>x.answers['question-a']===0&&x.answers['question-b']===1));
  assert.deepEqual((await call(db,'/api/admin/export',{},admin)).data.responses,exported.responses);
  assert.equal(/nickname|device|employee|response_id|timestamp|session/.test(JSON.stringify(exported)),false);
  const makeExcel=await writer(),bytes=makeExcel(exported),files=unzip(bytes);
  assert.equal(files.get('xl/workbook.xml').match(/<sheet /g).length,5);
  assert.match(files.get('xl/workbook.xml'),/name="평가 현황"/);
  exported.responses.forEach((r,i)=>{
   const xml=files.get('xl/worksheets/sheet'+(i+4)+'.xml');
   assert.equal(xml.match(/<row /g).length,6);assert.match(xml,/<c r="A5" s="3"><v>1<\/v>/);
   assert.equal(/바람|SUM|닉네임/.test(xml),false);
   assert.ok(xml.includes('응답 '+String(i+1).padStart(3,'0')));
   exported.statistics.forEach(q=>assert.ok(xml.includes(q.options[r.answers[q.id]])));
  });
  assert.equal(/<f[ >]/.test([...files.values()].join('')),false);
  assert.throws(()=>makeExcel({...exported,response_count:1}));
  assert.throws(()=>makeExcel({...exported,completed:0}));
  assert.throws(()=>makeExcel({...exported,responses:[{nickname:'bad',answers:{'question-a':7,'question-b':1}},exported.responses[1]]}));
  assert.throws(()=>makeExcel({...exported,responses:[exported.responses[0],exported.responses[0]]}));
  const output=new URL('../.private/test-output/',import.meta.url);await mkdir(output,{recursive:true});await writeFile(new URL('anonymous-statistics.xlsx',output),bytes);
 }finally{await db.close();}
});
test('upgrade deletes identity data, preserves all old totals and answer sets, and can run twice',async()=>{
 const db=await database({version:1});try{
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;
  const oldSession=await legacySubmit(db,'TEST-A1',{'question-a':0,'question-b':1});
  await db.exec(await readFile(new URL('202609030002_anonymous_response_export.sql',migrations),'utf8'));
  await legacySubmit(db,'TEST-A2',{'question-a':1,'question-b':2});
  const migration=await readFile(new URL('202609030003_nickname_rounds.sql',migrations),'utf8');
  await db.exec(migration);
  let exported=(await call(db,'/api/admin/export',{},admin)).data;
  assert.equal(exported.completed,2);assert.equal(exported.response_count,1);assert.equal(exported.unavailable_response_count,1);
  assert.deepEqual(exported.statistics.map(q=>q.counts),[[1,1],[0,1,1]]);
  assert.deepEqual(exported.responses[0].answers,{'question-a':1,'question-b':2});
  assert.equal((await call(db,'/api/evaluate/session',{},oldSession)).status,401);
  const source=(await db.query('select source from evaluate_private.settings')).rows[0].source;
  assert.equal(/people|departments|cohorts|TEST-|검증자/.test(JSON.stringify(source)),false);
  const cols=(await db.query("select table_name,column_name from information_schema.columns where table_schema='evaluate_private'")).rows;
  assert.equal(cols.some(x=>['participation','counts','anonymous_responses'].includes(x.table_name)||x.column_name==='employee'),false);
  await submit(db,'새로운바람',3,{'question-a':1,'question-b':0});
  const before=(await call(db,'/api/admin/export',{},admin)).data;
  await db.exec(migration);exported=(await call(db,'/api/admin/export',{},admin)).data;
  assert.deepEqual(exported,before);assert.equal(exported.completed,3);
  const files=unzip((await writer())(exported));assert.equal(files.get('xl/workbook.xml').match(/<sheet /g).length,5);assert.match(files.get('xl/worksheets/sheet3.xml'),/1건은 합계만 저장/);
 }finally{await db.close();}
});
