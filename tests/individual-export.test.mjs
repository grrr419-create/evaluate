import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {database,call} from './helpers.mjs';
import {fixture,fixtureAdmin} from './fixtures.mjs';

const migration=new URL('../supabase/migrations/202609030002_anonymous_response_export.sql',import.meta.url);
async function submit(db,id,answers){
 const session=(await call(db,'/api/evaluate/login',{id,password:id})).data.session;
 const view=(await call(db,'/api/evaluate/acknowledge',{notice_version:fixture.notice_version},session)).data;
 const body={answers,epoch:view.epoch,assessment_version:view.assessment_version};
 assert.equal((await call(db,'/api/evaluate/submit',body,session)).status,200);
 return {session,body};
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
  const name=data.subarray(at+30,at+30+nameLength).toString();
  const start=at+30+nameLength+extraLength;result.set(name,data.subarray(start,start+size).toString());at=start+size;
 }
 return result;
}
test('anonymous answer sets stay locked, are not linked to identity, and reset atomically',async()=>{
 const db=await database();try{
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;
  const first=await submit(db,'TEST-A1',{'question-a':0,'question-b':1});
  assert.equal((await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).status,403);
  assert.equal((await call(db,'/api/admin/export',{department:'검증부서 A'},first.session)).status,401);
  assert.equal((await call(db,'/api/evaluate/submit',first.body,first.session)).status,409);
  assert.equal((await db.query('select count(*)::int n from evaluate_private.anonymous_responses')).rows[0].n,1);
  await submit(db,'TEST-A2',{'question-a':1,'question-b':2});
  await submit(db,'TEST-B1',{'question-a':1,'question-b':0});
  const exported=(await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).data;
  assert.equal(exported.response_count,2);assert.equal(exported.unavailable_response_count,0);
  assert.deepEqual(exported.responses.map(x=>JSON.stringify(x)).sort(),[{'question-a':0,'question-b':1},{'question-a':1,'question-b':2}].map(x=>JSON.stringify(x)).sort());
  assert.deepEqual((await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).data.responses,exported.responses);
  assert.equal(JSON.stringify((await call(db,'/api/admin/dashboard',{},admin)).data).includes('responses'),false);
  assert.equal(/TEST-|검증자|employee|response_id|timestamp/.test(JSON.stringify(exported.responses)),false);
  const columns=(await db.query("select column_name from information_schema.columns where table_schema='evaluate_private' and table_name='anonymous_responses' order by ordinal_position")).rows.map(x=>x.column_name);
  assert.deepEqual(columns,['response_id','department','answers']);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from evaluate_private.anonymous_responses'),/permission denied/);await db.exec('reset role');}
  const makeExcel=await writer(),bytes=makeExcel(exported),files=unzip(bytes);
  assert.equal(files.get('xl/workbook.xml').match(/<sheet /g).length,5);
  assert.match(files.get('xl/workbook.xml'),/name="응답 001"/);assert.match(files.get('xl/workbook.xml'),/name="응답 002"/);
  for(let i=4;i<=5;i++){const xml=files.get('xl/worksheets/sheet'+i+'.xml');assert.equal(xml.match(/<row /g).length,6);assert.match(xml,/<c r="A5" s="3"><v>1<\/v>/);assert.equal(/TEST-|검증자|<f[ >]/.test(xml),false);}
  assert.throws(()=>makeExcel({...exported,response_count:1}));
  assert.throws(()=>makeExcel({...exported,responses:[{'question-a':7,'question-b':1},exported.responses[1]]}));
  assert.throws(()=>makeExcel({...exported,responses:[{'question-a':0,'question-b':1},{'question-a':0,'question-b':1}]}));
  const injection={...exported,name:'=HYPERLINK("https://example.invalid")',statistics:exported.statistics.map(q=>({...q,text:'<tag>&'+q.text,options:q.options.map(o=>'=SUM(1,2) '+o)}))};
  const xml=Array.from(unzip(makeExcel(injection)).values()).join('');assert.equal(/<f[ >]/.test(xml),false);assert.match(xml,/&lt;tag&gt;&amp;/);
  const output=new URL('../.private/test-output/',import.meta.url);await mkdir(output,{recursive:true});await writeFile(new URL('individual-statistics.xlsx',output),bytes);
  const nonce=(await call(db,'/api/admin/reset-preview',{},admin)).data.token;
  assert.equal((await call(db,'/api/admin/reset',{token:nonce,confirmation:'정말로 초기화 하시겠습니까?'},admin)).status,200);
  assert.equal((await db.query('select count(*)::int n from evaluate_private.anonymous_responses')).rows[0].n,0);
  assert.equal((await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).status,403);
 }finally{await db.close();}
});
test('upgrade preserves aggregate-only submissions and never fabricates individual responses',async()=>{
 const db=await database({legacy:true});try{
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;
  await submit(db,'TEST-A1',{'question-a':0,'question-b':1});
  const before=(await db.query('select * from evaluate_private.counts order by question,choice')).rows;
  await db.exec(await readFile(migration,'utf8'));await db.exec(await readFile(migration,'utf8'));
  assert.deepEqual((await db.query('select * from evaluate_private.counts order by question,choice')).rows,before);
  assert.equal((await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).status,403);
  await submit(db,'TEST-A2',{'question-a':1,'question-b':2});
  const exported=(await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).data;
  assert.equal(exported.total,2);assert.equal(exported.response_count,1);assert.equal(exported.unavailable_response_count,1);
  assert.deepEqual(exported.statistics.map(q=>q.counts),[[1,1],[0,1,1]]);
  assert.deepEqual(exported.responses,[{'question-a':1,'question-b':2}]);
  const makeExcel=await writer(),files=unzip(makeExcel(exported));assert.equal(files.get('xl/workbook.xml').match(/<sheet /g).length,4);assert.match(files.get('xl/worksheets/sheet3.xml'),/1건은 합계만 저장/);
  const legacyOnly={...exported,responses:[],response_count:0,unavailable_response_count:2};
  assert.equal(unzip(makeExcel(legacyOnly)).get('xl/workbook.xml').match(/<sheet /g).length,3);
 }finally{await db.close();}
});
