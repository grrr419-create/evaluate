'use strict';
const app=document.getElementById('app'), modal=document.getElementById('reset-dialog'), submitModal=document.getElementById('submit-dialog');
const role=document.documentElement.dataset.role||'evaluate';
const state={csrf:'',view:null,data:null,logged:false,answers:{},selected:'',filter:'all',error:'',busy:false,stale:false,notice:'',exporting:false};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,cls='secondary-button',disabled=false)=>'<button class="'+cls+'" data-action="'+action+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
const alertBox=()=>state.error?'<div class="alert error" role="alert">'+esc(state.error)+'</div>':state.notice?'<div class="alert success" role="status">'+esc(state.notice)+'</div>':'';
const smallLogo='<span class="logo-mark" aria-hidden="true">H</span><div class="logo-text">HANSHIN<small>업무환경 심리평가</small></div>';
async function bootstrap(){await AssessmentAPI.init(role);}
async function api(path,body){return AssessmentAPI.request(path,body);}
function countAnswered(){return (state.view?.questions||[]).filter(q=>Number.isInteger(state.answers[q.id])).length;}
function renderLogin(){
 document.title=(role==='admin'?'관리자 로그인':'업무환경 심리평가')+' | HANSHIN';
 app.innerHTML='<main class="login-shell"><section class="brand-panel" aria-label="HANSHIN 업무환경 심리평가"></section><section class="login-panel"><form class="login-form" id="login-form">'+(role==='admin'?'<p class="eyebrow">ADMINISTRATION</p><h1>관리자 로그인</h1><p class="subtle">부서별 참여 현황과 평가 통계를 확인하세요.</p>':'')+alertBox()+'<label class="login-field"><span>ID</span><input name="id" aria-label="ID" placeholder="'+(role==='admin'?'관리자 ID':'사번')+'" autocomplete="username" autocapitalize="none" spellcheck="false" enterkeyhint="next" inputmode="'+(role==='evaluate'?'numeric':'text')+'" required maxlength="80"></label><label class="login-field"><span>PW</span><input name="password" aria-label="PW" type="password" placeholder="'+(role==='admin'?'관리자 비밀번호':'사번')+'" autocomplete="current-password" autocapitalize="none" spellcheck="false" enterkeyhint="go" inputmode="'+(role==='evaluate'?'numeric':'text')+'" required maxlength="160"></label><button class="primary-button" type="submit" '+(state.busy?'disabled':'')+'>'+(state.busy?'로그인 중…':'로그인 <span aria-hidden="true">→</span>')+'</button><p class="login-hint">'+(role==='admin'?'관리자 전용 계정으로 로그인해 주세요.':'ID와 PW에 본인의 사번을 입력해 주세요.')+'</p></form><footer>HANSHIN <span>업무환경 심리평가</span></footer></section></main>';
 document.getElementById('login-form').onsubmit=async e=>{
  e.preventDefault();if(state.busy)return;const form=e.currentTarget,data=new FormData(form),id=String(data.get('id')).trim();const btn=form.querySelector('button');state.busy=true;btn.disabled=true;btn.textContent='로그인 중…';
  try{await api('/api/'+role+'/login',{id,password:String(data.get('password'))});state.logged=true;state.error='';await load();}
  catch(err){state.error=err.message;state.logged=false;renderLogin();document.querySelector('[name=id]').value=id;}
  finally{state.busy=false;if(state.logged){render();}else{const b=document.querySelector('#login-form button');if(b){b.disabled=false;b.textContent='로그인 →';}}}
 };
}
function header(){return '<header class="topbar"><a class="brand-link" href="./index.html">'+smallLogo+'</a><div class="topbar-right"><span>'+esc(state.view?.person.name||'')+' <small>'+esc(state.view?.person.department||'')+'</small></span>'+button('로그아웃','logout','text-button')+'</div></header>';}
function renderEvaluation(){
 if(!state.logged)return renderLogin();
 const v=state.view;document.title='업무환경 심리평가 | HANSHIN';
 if(!v){app.innerHTML=header()+'<main class="center-page">'+alertBox()+button('다시 불러오기','refresh')+'</main>';return;}
 let main='';
 if(v.complete){main='<main class="center-page"><div class="completion-icon" aria-hidden="true">✓</div><p class="eyebrow">ASSESSMENT COMPLETED</p><h1>평가 제출이 완료되었습니다.</h1><p class="subtle">소중한 의견을 남겨주셔서 감사합니다.<br>더 나은 근무환경을 만드는 데 활용하겠습니다.</p><div class="completion-note">제출한 평가는 중복으로 제출할 수 없습니다.</div>'+button('로그아웃','logout','primary-button')+'</main>';}
 else if(!v.accepted){main='<main class="notice-page" aria-label="평가 안내">'+alertBox()+'<article class="notice-card"><div class="notice-content">'+esc(v.notice||'등록된 안내 문구가 없습니다.')+'</div></article>'+button('평가 시작하기','acknowledge','primary-button',state.busy)+'</main>';}
 else{
  const n=countAnswered(),total=v.questions.length;
  main='<main class="survey-layout"><section><h1>업무환경 심리평가</h1>'+alertBox()+(state.stale?'<div class="alert warning" role="alert">평가 문항 또는 대상 명단이 변경되었습니다. 새 평가를 불러온 후 작성해 주세요. '+button('새 평가 불러오기','reload-assessment')+'</div>':'')+'<form id="survey-form">'+v.questions.map((q,i)=>'<fieldset class="question-card" id="question-'+i+'" '+(state.busy||state.stale?'disabled':'')+'><legend><span class="question-number">'+String(i+1).padStart(2,'0')+'</span><span>'+esc(q.text.replace(/^\s*\d+[.)]\s*/,''))+'</span></legend><div class="choices">'+q.options.map((o,j)=>'<label class="choice"><input type="radio" name="'+esc(q.id)+'" value="'+j+'" '+(state.answers[q.id]===j?'checked':'')+' required><span class="radio-dot"></span><span>'+esc(o)+'</span></label>').join('')+'</div></fieldset>').join('')+'<div class="submit-area"><button class="primary-button" type="submit" id="submit-assessment" '+(n!==total||state.busy||state.stale?'disabled':'')+'>'+(state.busy?'제출 중…':'제출하기')+'</button></div></form></section></main>';
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
function statusLabel(d){return d.unlocked?'<span class="badge ready">통계 공개</span>':'<span class="badge pending">집계 대기</span>';}
function statistics(d){
 if(!d)return '';
 if(!d.unlocked)return '<div class="locked-panel"><span class="lock-symbol" aria-hidden="true">▣</span><h3>아직 통계를 확인할 수 없습니다.</h3><p>부서 구성원 전원이 평가를 마치면 통계가 공개됩니다.</p><strong>'+d.completed+'명 참여 <span>/ '+d.total+'명</span></strong><div class="progress-rail"><span style="width:'+percentage(d.completed,d.total)+'%"></span></div><small>'+d.pending+'명의 참여를 기다리고 있습니다.</small></div>';
 return '<div class="results-list">'+d.statistics.map((q,i)=>'<article class="result-question"><h3><span>'+String(i+1).padStart(2,'0')+'</span>'+esc(q.text.replace(/^\s*\d+[.)]\s*/,''))+'</h3><div class="stacked-bar" aria-hidden="true">'+q.counts.map((n,j)=>'<span class="bar-color-'+j%5+'" style="width:'+(n/d.total*100)+'%"></span>').join('')+'</div><div class="result-options">'+q.options.map((o,j)=>'<span><i class="bar-color-'+j%5+'"></i>'+esc(o)+' <strong>'+q.counts[j]+'명</strong> <em>'+(q.counts[j]/d.total*100).toFixed(1)+'%</em></span>').join('')+'</div></article>').join('')+'</div>';
}
function renderAdmin(){
 if(!state.logged)return renderLogin();
 document.title='관리자 | 업무환경 심리평가';
 const d=state.data,selected=d?.departments.find(x=>x.name===state.selected),open=d?.departments.filter(x=>x.unlocked).length||0;
 const filtered=(d?.participants||[]).filter(p=>(!state.selected||p.department===state.selected)&&(state.filter==='all'||(state.filter==='complete'&&p.complete)||(state.filter==='pending'&&!p.complete)));
 const actions='<div class="dashboard-actions">'+button('↻ 새로고침','refresh')+button('결과 초기화','reset-open','danger-button')+'</div>';
 const content=d?'<div class="dashboard-heading"><div><h1>평가 현황</h1></div>'+actions+'</div>'+alertBox()+'<div class="metric-grid"><article><span>전체 평가대상</span><strong>'+d.total+'<small>명</small></strong><p>'+d.departments.length+'개 부서</p></article><article><span>참여 완료</span><strong>'+d.completed+'<small>명</small></strong><p>전체 참여율 '+percentage(d.completed,d.total)+'%</p></article><article><span>미참여</span><strong>'+(d.total-d.completed)+'<small>명</small></strong><p>참여 대기 중</p></article><article class="metric-highlight"><span>통계 공개 부서</span><strong>'+open+'<small>/ '+d.departments.length+'</small></strong><p>전원 참여 시 자동 공개</p></article></div><section class="panel" id="departments"><div class="section-heading"><div><h2>부서별 참여 현황</h2><p class="subtle">부서를 선택하면 참여 명단과 문항별 통계를 볼 수 있습니다.</p></div></div><div class="department-cards">'+d.departments.map(dep=>'<button class="department-card '+(dep.name===state.selected?'selected':'')+'" data-department="'+esc(dep.name)+'"><div><h3>'+esc(dep.name)+'</h3>'+statusLabel(dep)+'</div><p><strong>'+dep.completed+'</strong> / '+dep.total+'명 <span>'+percentage(dep.completed,dep.total)+'%</span></p><div class="progress-rail"><span style="width:'+percentage(dep.completed,dep.total)+'%"></span></div></button>').join('')+'</div></section><section class="panel" id="participation"><div class="section-heading"><div><p class="section-kicker">'+esc(state.selected||'전체 부서')+'</p><h2>참여 · 미참여 명단</h2></div></div><div class="filter-line"><div class="segmented" aria-label="참여 상태">'+[['all','전체'],['complete','참여'],['pending','미참여']].map(([v,t])=>'<button data-filter="'+v+'" class="'+(state.filter===v?'active':'')+'" aria-pressed="'+(state.filter===v)+'">'+t+'</button>').join('')+'</div><span class="subtle">'+filtered.length+'명</span></div><div class="table-wrap"><table><thead><tr><th>소속부서</th><th>사번</th><th>직위</th><th>성명</th><th>참여 여부</th></tr></thead><tbody>'+filtered.map(p=>'<tr><td data-label="소속부서">'+esc(p.department)+'</td><td class="employee-id" data-label="사번">'+esc(p.id)+'</td><td data-label="직위">'+esc(p.position)+'</td><td data-label="성명">'+esc(p.name)+'</td><td data-label="참여 여부"><span class="badge '+(p.complete?'ready':'pending')+'">'+(p.complete?'참여 완료':'미참여')+'</span></td></tr>').join('')+(filtered.length?'':'<tr><td colspan="5" class="empty-row">조건에 맞는 대상자가 없습니다.</td></tr>')+'</tbody></table></div></section><section class="panel" id="statistics"><div class="section-heading"><div><p class="section-kicker">'+esc(state.selected||'')+'</p><h2>문항별 응답 통계</h2></div>'+button(state.exporting?'엑셀 생성 중…':'↓ 통계 엑셀 다운로드','export-department','secondary-button',!selected?.unlocked||state.exporting)+'</div>'+statistics(selected)+'</section>': '<div class="dashboard-heading"><h1>자료 확인이 필요합니다.</h1>'+actions+'</div>'+alertBox();
 app.innerHTML='<div class="admin-layout"><div class="admin-main"><header class="admin-topbar"><span>업무환경 심리평가 <b>관리자</b></span><div><span class="live-dot"></span><small>자동 갱신</small>'+button('로그아웃','logout','text-button')+'</div></header><main class="dashboard">'+content+'<footer>HANSHIN <span>업무환경 심리평가 관리</span></footer></main></div></div>';
}
function render(){role==='admin'?renderAdmin():renderEvaluation();}
async function load(){
 try{
  if(role==='admin'){state.data=await api('/api/admin/dashboard');if(!state.data.departments.some(d=>d.name===state.selected))state.selected=state.data.departments[0]?.name||'';}
  else state.view=await api('/api/evaluate/session');
  state.logged=true;state.error='';render();
 }catch(err){if(err.status===401){const wasLogged=state.logged;state.logged=false;state.error=wasLogged?err.message:'';}else{state.logged=true;state.error=err.message;state.data=null;}render();}
}
async function download(department){
 if(state.exporting)return;state.exporting=true;state.error='';state.notice='';renderAdmin();
 try{const selected=await api('/api/admin/export',{department});const bytes=StatisticsExcel.create(selected);const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='업무환경_심리평가_'+department+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);state.notice='통계와 익명 개별 응답 '+selected.response_count+'건을 내려받았습니다.'+(selected.unavailable_response_count?' 기존 제출 '+selected.unavailable_response_count+'건은 개별 답변이 보관되어 있지 않아 취합 통계에만 포함됩니다.':'');}catch(err){state.error=err.message;}finally{state.exporting=false;renderAdmin();}
}
async function openReset(){
 try{const preview=await api('/api/admin/reset-preview');modal.innerHTML='<div class="modal-content"><span class="reset-icon" aria-hidden="true">↺</span><h2 id="reset-title">정말로 초기화 하시겠습니까?</h2><p>모든 부서의 평가 결과와 참여 기록이 삭제됩니다.<br>이 작업은 되돌릴 수 없습니다.</p><div class="modal-actions"><button class="secondary-button" id="cancel-reset" autofocus>취소</button><button class="danger-solid" id="confirm-reset">결과 초기화</button></div><p id="reset-error" role="alert"></p></div>';modal.showModal();document.getElementById('cancel-reset').onclick=()=>modal.close();document.getElementById('confirm-reset').onclick=async()=>{const btn=document.getElementById('confirm-reset');btn.disabled=true;btn.textContent='초기화 중…';try{await api('/api/admin/reset',{token:preview.token,confirmation:'정말로 초기화 하시겠습니까?'});modal.close();state.notice='모든 평가 결과와 참여 기록이 초기화되었습니다.';await load();}catch(err){document.getElementById('reset-error').textContent=err.message;btn.disabled=false;btn.textContent='결과 초기화';}};}catch(err){state.error=err.message;render();}
}
app.addEventListener('click',async e=>{
 const dep=e.target.closest('[data-department]');if(dep){state.selected=dep.dataset.department;state.filter='all';renderAdmin();return;}
 const filter=e.target.closest('[data-filter]');if(filter){state.filter=filter.dataset.filter;renderAdmin();return;}
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
 const action=b.dataset.action;
 try{
  if(action==='logout'){await api('/api/'+role+'/logout',{});state.logged=false;state.view=null;state.data=null;state.answers={};state.error='';state.notice='';render();}
  if(action==='refresh'){state.error='';await load();}
  if(action==='reload-assessment'){state.answers={};state.stale=false;state.error='';await load();window.scrollTo(0,0);}
  if(action==='acknowledge'){state.busy=true;state.error='';renderEvaluation();try{state.view=await api('/api/evaluate/acknowledge',{notice_version:state.view.notice_version});}finally{state.busy=false;}renderEvaluation();window.scrollTo(0,0);}
  if(action==='reset-open')await openReset();
  if(action==='export-department')await download(state.selected);
 }catch(err){state.error=err.message;if(err.status===401){state.logged=false;state.answers={};}render();}
});
async function poll(){
 if(document.hidden||!state.logged||state.busy||state.exporting||modal.open||submitModal.open)return;
 try{
  if(role==='admin'){
   const data=await api('/api/admin/dashboard');state.data=data;if(!data.departments.some(d=>d.name===state.selected))state.selected=data.departments[0]?.name||'';
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
 const context=document.modelContext;if(context?.registerTool&&role==='admin'){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{await context.registerTool({name:'get_department_participation',title:'부서별 참여 현황 확인',description:'관리자로 로그인한 상태에서 부서별 대상 인원, 참여 인원과 통계 공개 여부를 확인합니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},async execute(input){if(input&&Object.keys(input).length)throw new Error('입력값은 필요하지 않습니다.');if(!state.logged)throw new Error('관리자 로그인이 필요합니다.');await load();if(!state.data)throw new Error('참여 현황을 불러오지 못했습니다.');return {departments:state.data.departments.map(({name,total,completed,unlocked})=>({name,total,completed,unlocked}))};}},{signal:lifecycle.signal});}catch{/* Optional browser API; normal UI remains available. */}}
}
init();
