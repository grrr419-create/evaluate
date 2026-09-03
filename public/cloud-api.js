/* Supabase endpoint settings are public; only opaque per-user sessions live in this tab. */
'use strict';
const AssessmentAPI=(()=>{
 let endpoint='',session='',storageKey='',ready=false;
 const failure=(message,status=503)=>Object.assign(new Error(message),{status});
 async function init(role){
  const response=await fetch('./config.json',{cache:'no-store'});
  if(!response.ok)throw failure('연결 설정을 불러오지 못했습니다.');
  const config=await response.json();
  const localPreview=typeof config.apiUrl==='string'&&['127.0.0.1','localhost'].includes(location.hostname)&&config.apiUrl===location.origin+'/api-gateway';
  if(!localPreview&&(typeof config.apiUrl!=='string'||!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/evaluate$/.test(config.apiUrl)))throw failure('평가 서버 연결을 준비 중입니다.');
  endpoint=config.apiUrl;storageKey='evaluate-session:'+endpoint+':'+role;
  try{session=sessionStorage.getItem(storageKey)||'';}catch{session='';}
  ready=true;
 }
 async function request(route,body={}){
  if(!ready)throw failure('평가 서버 연결을 준비 중입니다.');
  if(!route.endsWith('/login')&&!session)throw failure('로그인이 필요합니다.',401);
  let response;
  try{response=await fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({route,body,session}),signal:AbortSignal.timeout(30000)});}
  catch{throw failure('서버에 연결하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.');}
  let data;try{data=await response.json();}catch{throw failure('서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
  if(!response.ok){
   if(response.status===401&&!route.endsWith('/login')){session='';try{sessionStorage.removeItem(storageKey);}catch{}}
   throw failure(data.error||'처리에 실패했습니다.',response.status);
  }
  if(route.endsWith('/login')){session=data.session;try{sessionStorage.setItem(storageKey,session);}catch{}delete data.session;}
  if(route.endsWith('/logout')){session='';try{sessionStorage.removeItem(storageKey);}catch{}}
  return data;
 }
 return {init,request};
})();
