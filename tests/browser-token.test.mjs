import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';
test('browser token persists across sessions; unavailable storage does not silently bypass the limit',async()=>{
 const saved=new Map(),requests=[];let blocked=false;
 const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>{if(blocked)throw new Error('blocked');saved.set(k,v);},removeItem:k=>saved.delete(k)};
 const source=await readFile(new URL('../public/cloud-api.js',import.meta.url),'utf8');
 async function client(){
  const ctx=vm.createContext({crypto:webcrypto,AbortSignal,location:{hostname:'example.github.io'},localStorage:storage,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:async(url,opts)=>{
   if(url==='./config.json')return Response.json({apiUrl:'https://project.supabase.co/functions/v1/evaluate'});
   requests.push(JSON.parse(opts.body));return Response.json({session:'opaque-fixture',ok:true});
  }});vm.runInContext(source+'\nthis.api=AssessmentAPI;',ctx);await ctx.api.init('evaluate');return ctx.api;
 }
 const a=await client();await a.request('/api/evaluate/login',{nickname:'바람'});await a.request('/api/evaluate/logout');
 const b=await client();await b.request('/api/evaluate/login',{nickname:'바람'});
 assert.match(requests[0].body.device,/^[0-9a-f]{64}$/);assert.equal(requests[0].body.device,requests[2].body.device);
 saved.clear();blocked=true;const c=await client();await assert.rejects(c.request('/api/evaluate/login',{nickname:'바람'}),/저장/);assert.equal(requests.length,3);
});
