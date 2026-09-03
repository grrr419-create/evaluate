// Isolated test-only Postgres. Does not connect to the real Supabase project.
import http from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {database,call,handler} from '../tests/helpers.mjs';
const root=new URL('../',import.meta.url),db=await database(),createHandler=await handler();
let origin,handle;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const files=new Set(['index.html','admin.html','app.js','cloud-api.js','statistics-excel.js','style.css','login-reference.jpg','favicon.svg']);
const server=http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,origin).pathname.slice(1)||'index.html';
  if(path==='config.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({apiUrl:origin+'/api-gateway'}));return;}
  if(path==='api-gateway'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await handle(new Request(origin+'/api-gateway',{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!files.has(path)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[path.slice(path.lastIndexOf('.'))],'Cache-Control':'no-store'});res.end(await readFile(new URL('public/'+path,root)));
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Preview server error'}));}
});
server.listen(0,'127.0.0.1',async()=>{
 origin='http://127.0.0.1:'+server.address().port;
 handle=createHandler({ALLOWED_ORIGINS:origin,SUPABASE_URL:'https://preview.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-only'},async(_url,opts)=>{const input=JSON.parse(opts.body);return Response.json(await call(db,input.p_route,input.p_body,input.p_session,input.p_client));});
 await mkdir(new URL('.private/',root),{recursive:true});await writeFile(new URL('.private/preview.json',root),JSON.stringify({pid:process.pid,url:origin}));console.log(origin);
});
