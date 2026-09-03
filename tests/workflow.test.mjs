import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import vm from 'node:vm';
import {database,call,handler} from './helpers.mjs';import {fixture,fixtureAdmin} from './fixtures.mjs';
test('atomic workflow, statistics threshold, reset and role isolation',async()=>{
 const db=await database();
 try{
  let r=await call(db,'/api/admin/dashboard');assert.equal(r.status,401);
  assert.equal((await call(db,'/api/evaluate/login',{id:'TEST-A1',password:'wrong'})).status,401);
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;
  assert.equal((await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).status,403);
  async function login(id){const r=await call(db,'/api/evaluate/login',{id,password:id});assert.equal(r.status,200);return r.data.session;}
  async function accept(token){const r=await call(db,'/api/evaluate/acknowledge',{notice_version:fixture.notice_version},token);assert.equal(r.status,200);return r.data;}
  const first=await login('TEST-A1');
  assert.equal((await call(db,'/api/admin/dashboard',{},first)).status,401);
  assert.equal((await call(db,'/api/evaluate/session',{},admin)).status,401);
  assert.equal((await call(db,'/api/evaluate/submit',{},first)).status,409);
  const view=await accept(first);
  const body={assessment_version:view.assessment_version,epoch:view.epoch,answers:{'question-a':0,'question-b':1}};
  for(const answers of [{}, {...body.answers,extra:1},{'question-a':true,'question-b':1},{'question-a':0.5,'question-b':1},{'question-a':2,'question-b':1}])assert.equal((await call(db,'/api/evaluate/submit',{...body,answers},first)).status,400);
  const duplicate=await Promise.all([call(db,'/api/evaluate/submit',body,first),call(db,'/api/evaluate/submit',body,first)]);assert.deepEqual(duplicate.map(x=>x.status).sort(),[200,409]);
  let dashboard=(await call(db,'/api/admin/dashboard',{},admin)).data;assert.equal(dashboard.completed,1);assert.equal(dashboard.departments[0].statistics,null);
  assert.equal((await call(db,'/api/admin/export',{department:'検証'},admin)).status,404);
  const second=await login('TEST-A2');await accept(second);assert.equal((await call(db,'/api/evaluate/submit',{...body,answers:{'question-a':1,'question-b':2}},second)).status,200);
  dashboard=(await call(db,'/api/admin/dashboard',{},admin)).data;assert.equal(dashboard.completed,2);assert.equal(dashboard.departments[0].unlocked,true);assert.equal(dashboard.departments[1].statistics,null);
  const exported=await call(db,'/api/admin/export',{department:'검증부서 A'},admin);assert.equal(exported.status,200);assert.deepEqual(exported.data.statistics[0].counts,[1,1]);assert.deepEqual(exported.data.statistics[1].counts,[0,1,1]);
  // Aggregate totals remain separate from participation and anonymous answer sets.
  const columns=(await db.query("select column_name from information_schema.columns where table_schema='evaluate_private' and table_name='counts' order by ordinal_position")).rows.map(x=>x.column_name);
  assert.deepEqual(columns,['department','question','choice','n']);
  assert.equal((await call(db,'/api/admin/upload',{},admin)).status,404);
  const nonce=(await call(db,'/api/admin/reset-preview',{},admin)).data.token;
  assert.equal((await call(db,'/api/admin/reset',{token:nonce,confirmation:'wrong'},admin)).status,400);
  assert.equal((await call(db,'/api/admin/reset',{token:nonce,confirmation:'정말로 초기화 하시겠습니까?'},admin)).status,200);
  assert.equal((await call(db,'/api/admin/reset',{token:nonce,confirmation:'정말로 초기화 하시겠습니까?'},admin)).status,400);
  assert.equal((await call(db,'/api/evaluate/session',{},first)).status,401);
  assert.equal((await call(db,'/api/admin/dashboard',{},admin)).data.completed,0);
  assert.equal((await call(db,'/api/admin/export',{department:'검증부서 A'},admin)).status,403);
  const newSession=await login('TEST-A1');await accept(newSession);assert.equal((await call(db,'/api/evaluate/submit',body,newSession)).status,409);
  const context=vm.createContext({TextEncoder});vm.runInContext(await readFile(new URL('../public/statistics-excel.js',import.meta.url),'utf8')+'\nthis.makeExcel=StatisticsExcel.create;',context);
  const bytes=context.makeExcel(exported.data);assert.equal(Buffer.from(bytes.subarray(0,2)).toString(),'PK');
  await mkdir(new URL('../.private/test-output/',import.meta.url),{recursive:true});await writeFile(new URL('../.private/test-output/statistics.xlsx',import.meta.url),bytes);
  assert.throws(()=>context.makeExcel({...exported.data,unlocked:false}));
 }finally{await db.close();}
});
test('direct anonymous database access is denied, login limits and sessions expire',async()=>{
 const db=await database();try{
  await db.exec('set role anon;');
  await assert.rejects(db.query("select * from evaluate_private.settings"),/permission denied/);
  await assert.rejects(db.query("select public.evaluate_api('/api/admin/dashboard')"),/permission denied/);
  await db.exec('reset role;set role authenticated;');await assert.rejects(db.query("select public.evaluate_api('/api/admin/dashboard')"),/permission denied/);await db.exec('reset role;');
  for(let i=0;i<10;i++)assert.equal((await call(db,'/api/admin/login',{id:fixtureAdmin.id,password:'wrong'},'',String(i))).status,401);
  assert.equal((await call(db,'/api/admin/login',fixtureAdmin,'','next-ip')).status,429);
  await db.exec("update evaluate_private.login_limits set window_start=now()-interval '16 minutes'");
  const admin=(await call(db,'/api/admin/login',fixtureAdmin)).data.session;await db.exec("update evaluate_private.sessions set expires_at=now()-interval '1 second'");assert.equal((await call(db,'/api/admin/dashboard',{},admin)).status,401);
  await assert.rejects(db.query('select evaluate_private.install($1::jsonb,$2,$3)',[JSON.stringify({...fixture,revision:'changed'}),fixtureAdmin.id,fixtureAdmin.password]),/already exists/);
 }finally{await db.close();}
});
test('Edge Function rejects foreign origins, excess bodies and anonymous privileged routes',async()=>{
 const db=await database();try{
  const createHandler=await handler();let calls=0;
  const handle=createHandler({ALLOWED_ORIGINS:'https://example.github.io',SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-only'},async(url,opts)=>{calls++;assert.equal(url,'https://project.supabase.co/rest/v1/rpc/evaluate_api');assert.equal(opts.headers.apikey,'fixture-service-only');const input=JSON.parse(opts.body);const result=await call(db,input.p_route,input.p_body,input.p_session,input.p_client);return Response.json(result);});
  const request=(input,origin='https://example.github.io')=>new Request('https://project.supabase.co/functions/v1/evaluate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await handle(request({route:'/api/admin/dashboard',session:'',body:{}},'https://attacker.example'))).status,403);assert.equal(calls,0);
  assert.equal((await handle(request({route:'/api/admin/dashboard',session:'',body:{}}))).status,401);
  assert.equal((await handle(request({route:'/api/admin/login',session:'',body:fixtureAdmin}))).status,200);
  assert.equal((await handle(request({route:'/api/admin/login',session:'',body:{value:'x'.repeat(65536)}}))).status,413);
  assert.equal((await handle(request({route:'/api/admin/upload',session:'',body:{}}))).status,400);
 }finally{await db.close();}
});
