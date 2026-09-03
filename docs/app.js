'use strict';
const app=document.getElementById('app'), modal=document.getElementById('reset-dialog'), submitModal=document.getElementById('submit-dialog');
const role=document.documentElement.dataset.role||'evaluate';
const state={view:null,data:null,logged:false,answers:{},error:'',busy:false,stale:false,notice:'',exporting:false};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,cls='secondary-button',disabled=false)=>'<button class="'+cls+'" data-action="'+action+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
const alertBox=()=>state.error?'<div class="alert error" role="alert">'+esc(state.error)+'</div>':state.notice?'<div class="alert success" role="status">'+esc(state.notice)+'</div>':'';
const smallLogo='<span class="logo-mark" aria-hidden="true">H</span><div class="logo-text">HANSHIN<small>업무환경 심리평가</small></div>';
async function bootstrap(){await AssessmentAPI.init(role);}
async function api(path,body){return AssessmentAPI.request(path,body);}
function countAnswered(){return (state.view?.questions||[]).filter(q=>Number.isInteger(state.answers[q.id])).length;}
function renderLogin(){
 const admin=role==='admin';
 document.title=(admin?'관리자 로그인':'업무환경 심리평가')+' | HANSHIN';
 const fields=admin?'<label class="login-field"><span>ID</span><input name="id" aria-label="ID" placeholder="관리자 ID" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="80"></label><label class="login-field"><span>PW</span><input name="password" aria-label="PW" type="password" placeholder="관리자 비밀번호" autocomplete="current-password" required maxlength="160"></label>':'<label class="login-field"><span>닉네임</span><input name="nickname" aria-label="닉네임" placeholder="사용할 닉네임을 입력해 주세요" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="go" required minlength="2" maxlength="30" aria-describedby="nickname-hint"></label>';
 app.innerHTML='<main class="login-shell"><section class="brand-panel" aria-label="HANSHIN 업무환경 심리평가"></section><section class="login-panel"><form class="login-form" id="login-form">'+(admin?'<h1>관리자 로그인</h1>':'')+alertBox()+fields+'<button class="primary-button" type="submit" '+(state.busy?'disabled':'')+'>'+(state.busy?'접속 중…':admin?'로그인 →':'평가 참여하기 →')+'</button><p class="login-hint" id="nickname-hint">'+(admin?'관리자 전용 계정으로 로그인해 주세요.':'본인을 알아볼 수 없는 닉네임을 입력해 주세요.<br>한 브라우저에서는 한 번만 참여할 수 있습니다.')+'</p></form><footer>HANSHIN <span>업무환경 심리평가</span></footer></section></main>';
 document.getElementById('login-form').onsubmit=async e=>{
  e.preventDefault();if(state.busy)return;
  const form=e.currentTarget,data=new FormData(form),value=String(data.get(admin?'id':'nickname')).trim();
  const body=admin?{id:value,password:String(data.get('password'))}:{nickname:value};
  state.busy=true;form.querySelector('button').disabled=true;form.querySelector('button').textContent='접속 중…';
  try{await api('/api/'+role+'/login',body);state.logged=true;state.error='';state.answers={};state.stale=false;await load();}
  catch(err){state.error=err.message;state.logged=false;}
  finally{state.busy=false;render();if(!state.logged){const input=document.querySelector(admin?'[name=id]':'[name=nickname]');if(input)input.value=value;}}
 };
}
function header(){return '<header class="topbar"><a class="brand-link" href="./index.html">'+smallLogo+'</a><div class="topbar-right"><span>'+esc(state.view?.nickname||'')+'</span>'+button('나가기','logout','text-button')+'</div></header>';}
function renderEvaluation(){
 if(!state.logged)return renderLogin();
 const v=state.view;document.title='업무환경 심리평가 | HANSHIN';
 if(!v){app.innerHTML=header()+'<main class="center-page">'+alertBox()+button('다시 불러오기','refresh')+'</main>';return;}
 let main='';
 if(v.complete){main='<main class="center-page"><div class="completion-icon" aria-hidden="true">✓</div><p class="eyebrow">ASSESSMENT COMPLETED</p><h1>평가 제출이 완료되었습니다.</h1><p class="subtle">소중한 의견을 남겨주셔서 감사합니다.<br>더 나은 근무환경을 만드는 데 활용하겠습니다.</p><div class="completion-note">제출한 평가는 중복으로 제출할 수 없습니다.</div>'+button('로그아웃','logout','primary-button')+'</main>';}
 else if(!v.accepted){main='<main class="notice-page" aria-label="평가 안내">'+alertBox()+'<article class="notice-card"><div class="notice-content">'+esc(v.notice||'등록된 안내 문구가 없습니다.')+'</div></article>'+button('평가 시작하기','acknowledge','primary-button',state.busy)+'</main>';}
 else{
  const n=countAnswered(),total=v.questions.length;
  main='<main class="survey-layout"><section><h1>'+esc(v.name||'업무환경 심리평가')+'</h1>'+alertBox()+(state.stale?'<div class="alert warning" role="alert">평가 상태가 변경되었습니다. 새 평가를 불러온 후 작성해 주세요. '+button('새 평가 불러오기','reload-assessment')+'</div>':'')+'<form id="survey-form">'+v.questions.map((q,i)=>'<fieldset class="question-card" id="question-'+i+'" '+(state.busy||state.stale?'disabled':'')+'><legend><span class="question-number">'+String(i+1).padStart(2,'0')+'</span><span>'+esc(q.text.replace(/^\s*\d+[.)]\s*/,''))+'</span></legend><div class="choices">'+q.options.map((o,j)=>'<label class="choice"><input type="radio" name="'+esc(q.id)+'" value="'+j+'" '+(state.answers[q.id]===j?'checked':'')+' required><span class="radio-dot"></span><span>'+esc(o)+'</span></label>').join('')+'</div></fieldset>').join('')+'<div class="submit-area"><button class="primary-button" type="submit" id="submit-assessment" '+(n!==total||state.busy||state.stale?'disabled':'')+'>'+(state.busy?'제출 중…':'제출하기')+'</button></div></form></section></main>';
 }
 app.innerHTML=header()+main;
 const form=document.getElementById('survey-form');
 if(form){
  form.onchange=e=>{if(e.target.type==='radio'){state.answers[e.target.name]=Number(e.target.value);updateSubmitAvailability();}};
  form.onsubmit=e=>{e.preventDefault();openSubmitConfirmation();};
 }
}
function openSubmitConfirmation(){
 const v=state.view;
 if(!state.logged||state.busy||state.stale||!v?.accepted||v.complete||countAnswered()!==v.questions.length||submitModal.open)return;
 submitModal.innerHTML='<div class="modal-content"><h2 id="submit-title">평가를 제출하시겠습니까?</h2><p id="submit-description">제출 후에는 답변을 변경할 수 없습니다.</p><div class="modal-actions"><button type="button" class="secondary-button" id="cancel-submit" autofocus>취소</button><button type="button" class="primary-button" id="confirm-submit">제출하기</button></div></div>';
 submitModal.showModal();
 document.getElementById('cancel-submit').onclick=()=>submitModal.close();
 document.getElementById('confirm-submit').onclick=async()=>{
  if(!submitModal.open||state.busy)return;
  submitModal.close();
  if(!state.logged||state.stale||state.view?.complete||state.view?.assessment_version!==v.assessment_version||state.view?.epoch!==v.epoch||countAnswered()!==v.questions.length)return;
  state.busy=true;state.error='';renderEvaluation();
  try{
   await api('/api/evaluate/submit',{answers:state.answers,assessment_version:v.assessment_version,epoch:v.epoch});
   state.answers={};state.view=await api('/api/evaluate/session');window.scrollTo(0,0);
  }catch(err){
   state.error=err.message;
   if(err.status===409)state.stale=true;
   if(err.status===401){state.logged=false;state.answers={};}
  }finally{state.busy=false;renderEvaluation();}
 };
}
function updateSubmitAvailability(){
 const submit=document.getElementById('submit-assessment');
 if(submit)submit.disabled=countAnswered()!==state.view.questions.length||state.stale||state.busy;
}
function percentage(n,d){return d?Math.round(n/d*100):0;}
function statistics(d){
 if(!d?.completed)return '<div class="empty-results"><h3>아직 제출된 평가가 없습니다.</h3><p>평가가 제출되면 문항별 통계를 확인할 수 있습니다.</p></div>';
 return '<div class="results-list">'+d.statistics.map((q,i)=>'<article class="result-question"><h3><span>'+String(i+1).padStart(2,'0')+'</span>'+esc(q.text.replace(/^\s*\d+[.)]\s*/,''))+'</h3><div class="stacked-bar" aria-hidden="true">'+q.counts.map((n,j)=>'<span class="bar-color-'+j%5+'" style="width:'+(n/d.completed*100)+'%"></span>').join('')+'</div><div class="result-options">'+q.options.map((o,j)=>'<span><i class="bar-color-'+j%5+'"></i>'+esc(o)+' <strong>'+q.counts[j]+'명</strong> <em>'+(q.counts[j]/d.completed*100).toFixed(1)+'%</em></span>').join('')+'</div></article>').join('')+'</div>';
}
function renderAdmin(){
 if(!state.logged)return renderLogin();
 document.title='관리자 | 업무환경 심리평가';
 const d=state.data;
 const actions='<div class="dashboard-actions">'+button('↻ 새로고침','refresh')+button('결과 초기화','reset-open','danger-button')+'</div>';
 const content='<div class="dashboard-heading"><h1>평가 현황</h1>'+actions+'</div>'+alertBox()+(d?'<section class="round-summary" aria-label="현재 평가"><div><span>현재 평가</span><h2>'+esc(d.name)+'</h2><p>마지막 초기화 이후 제출된 평가를 집계합니다.</p></div><div class="submitted-count"><span>참여 완료</span><strong>'+d.completed+'<small>명</small></strong></div></section><section class="panel" id="statistics"><div class="section-heading"><h2>문항별 응답 통계</h2>'+button(state.exporting?'엑셀 생성 중…':'↓ 통계·개별 응답 엑셀 다운로드','export-results','secondary-button',!d.completed||state.exporting)+'</div>'+statistics(d)+'</section>':'');
 app.innerHTML='<div class="admin-layout"><div class="admin-main"><header class="admin-topbar"><span>업무환경 심리평가 <b>관리자</b></span><div><span class="live-dot"></span><small>자동 갱신</small>'+button('로그아웃','logout','text-button')+'</div></header><main class="dashboard">'+content+'<footer>HANSHIN <span>업무환경 심리평가 관리</span></footer></main></div></div>';
}
function render(){role==='admin'?renderAdmin():renderEvaluation();}
async function load(){
 try{
  if(role==='admin')state.data=await api('/api/admin/dashboard');
  else state.view=await api('/api/evaluate/session');
  state.logged=true;state.error='';render();
 }catch(err){if(err.status===401){const wasLogged=state.logged;state.logged=false;state.error=wasLogged?err.message:'';}else{state.logged=true;state.error=err.message;state.data=null;}render();}
}
async function download(){
 if(state.exporting)return;state.exporting=true;state.error='';state.notice='';renderAdmin();
 try{
  const data=await api('/api/admin/export',{}),bytes=StatisticsExcel.create(data);
  const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='업무환경_심리평가_'+data.name.replace(/[\\/:*?"<>|]/g,'_')+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  state.notice='통계와 개별 응답 '+data.response_count+'건을 내려받았습니다.'+(data.unavailable_response_count?' 기존 제출 '+data.unavailable_response_count+'건은 개별 답변이 보관되어 있지 않아 취합 통계에만 포함됩니다.':'');
 }catch(err){state.error=err.message;}finally{state.exporting=false;renderAdmin();}
}
async function openReset(){
 try{
  const preview=await api('/api/admin/reset-preview');
  modal.innerHTML='<div class="modal-content"><span class="reset-icon" aria-hidden="true">↺</span><h2 id="reset-title">정말로 초기화 하시겠습니까?</h2><p>현재 평가의 답변과 참여 기록이 삭제됩니다.<br>필요한 결과는 먼저 엑셀로 내려받아 주세요.</p><div class="modal-actions"><button class="secondary-button" id="cancel-reset" autofocus>취소</button><button class="danger-solid" id="confirm-reset">결과 초기화</button></div><p id="reset-error" role="alert"></p></div>';
  modal.showModal();document.getElementById('cancel-reset').onclick=()=>modal.close();
  document.getElementById('confirm-reset').onclick=async()=>{
   const btn=document.getElementById('confirm-reset');btn.disabled=true;btn.textContent='초기화 중…';
   try{
    await api('/api/admin/reset',{token:preview.token,confirmation:'정말로 초기화 하시겠습니까?'});
    modal.close();state.notice='초기화되었습니다. 새 평가에 참여할 수 있습니다.';await load();
   }catch(err){document.getElementById('reset-error').textContent=err.message;btn.disabled=false;btn.textContent='결과 초기화';}
  };
 }catch(err){state.error=err.message;render();}
}
app.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
 const action=b.dataset.action;
 try{
  if(action==='logout'){await api('/api/'+role+'/logout',{});state.logged=false;state.view=null;state.data=null;state.answers={};state.error='';state.notice='';render();}
  if(action==='refresh'){state.error='';await load();}
  if(action==='reload-assessment'){state.answers={};state.stale=false;state.error='';await load();window.scrollTo(0,0);}
  if(action==='acknowledge'){state.busy=true;state.error='';renderEvaluation();try{state.view=await api('/api/evaluate/acknowledge',{notice_version:state.view.notice_version});}finally{state.busy=false;}renderEvaluation();window.scrollTo(0,0);}
  if(action==='reset-open')await openReset();
  if(action==='export-results')await download();
 }catch(err){state.error=err.message;if(err.status===401){state.logged=false;state.answers={};}render();}
});
async function poll(){
 if(document.hidden||!state.logged||state.busy||state.exporting||modal.open||submitModal.open)return;
 try{
  if(role==='admin'){
   state.data=await api('/api/admin/dashboard');
   state.error='';renderAdmin();
  }else{
   const next=await api('/api/evaluate/session'),old=state.view;
   if(old&&old.assessment_version!==next.assessment_version&&Object.keys(state.answers).length){state.stale=true;renderEvaluation();}
   else if(!old||old.assessment_version!==next.assessment_version||old.notice_version!==next.notice_version||old.complete!==next.complete||state.error){state.view=next;state.stale=false;state.error='';if(old?.assessment_version!==next.assessment_version)state.answers={};renderEvaluation();}
  }
 }catch(err){if(err.status===401){state.logged=false;state.answers={};state.error=err.message;render();}else{state.error=err.message;if(role==='admin')state.data=null;else state.stale=true;render();}}
}
window.addEventListener('beforeunload',e=>{if(role==='evaluate'&&Object.keys(state.answers).length&&!state.view?.complete){e.preventDefault();e.returnValue='';}});
async function init(){try{await bootstrap();await load();}catch(err){state.error=err.message;renderLogin();}setInterval(poll,30000);
 const context=document.modelContext;if(context?.registerTool&&role==='admin'){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await context.registerTool({name:'get_assessment_summary',title:'현재 평가 참여 인원 확인',description:'관리자로 로그인한 상태에서 현재 평가 이름과 제출 인원을 확인합니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},async execute(input){if(input&&Object.keys(input).length)throw new Error('입력값은 필요하지 않습니다.');if(!state.logged)throw new Error('관리자 로그인이 필요합니다.');await load();if(!state.data)throw new Error('참여 현황을 불러오지 못했습니다.');return {name:state.data.name,completed:state.data.completed};}},{signal:lifecycle.signal});}catch{/* Optional browser API; normal UI remains available. */}}
}
init();
