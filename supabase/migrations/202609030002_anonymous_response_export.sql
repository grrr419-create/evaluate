-- Retain anonymous answer sets for future exports. Existing aggregates are preserved.
-- No employee key, name, session, timestamp, or submission sequence is stored here.
-- Old aggregate-only submissions cannot be reconstructed and are reported as unavailable.
begin;
create table if not exists evaluate_private.anonymous_responses (
  response_id uuid primary key default gen_random_uuid(),
  department text not null,
  answers jsonb not null check(jsonb_typeof(answers)='object')
);
create index if not exists anonymous_responses_department_idx on evaluate_private.anonymous_responses(department);
alter table evaluate_private.anonymous_responses enable row level security;
revoke all on evaluate_private.anonymous_responses from public,anon,authenticated;
comment on table evaluate_private.anonymous_responses is 'Anonymous answer sets; deliberately no link to participation or sessions. Exported only after the whole department completes.';

create or replace function public.evaluate_api(p_route text,p_body jsonb default '{}'::jsonb,p_session text default '',p_client text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg evaluate_private.settings; sess evaluate_private.sessions; person jsonb; view_data jsonb; result jsonb; q jsonb; answers jsonb; raw_answer jsonb; ix integer; raw_token text; v_token_hash text; role_name text; identifier text; supplied text; valid boolean=false; buckets text[]; bucket_key text; amount integer; cap integer; dep text; nonce text;
begin
  if jsonb_typeof(p_body) is distinct from 'object' then return evaluate_private.failure(400,'요청 형식이 올바르지 않습니다.'); end if;
  -- All assessment operations use the same lock: submit, reset, and statistics are consistent.
  select * into cfg from evaluate_private.settings where singleton for update;
  if not found then return evaluate_private.failure(503,'평가 자료를 준비 중입니다. 관리자에게 문의해 주세요.'); end if;
  if p_route='/api/bootstrap' then return evaluate_private.reply(200,'{"ready":true}'::jsonb); end if;
  if p_route in ('/api/evaluate/login','/api/admin/login') then
    role_name=split_part(p_route,'/',3); identifier=btrim(coalesce(p_body->>'id','')); supplied=btrim(coalesce(p_body->>'password',''));
    if length(identifier)>80 or length(supplied)>160 then return evaluate_private.failure(400,'입력 길이를 확인해 주세요.'); end if;
    delete from evaluate_private.login_limits where window_start<now()-interval '15 minutes';
    delete from evaluate_private.sessions where expires_at<now();
    buckets=array[encode(extensions.hmac('ip:'||coalesce(p_client,''),cfg.secret,'sha256'),'hex'),encode(extensions.hmac(role_name||':'||identifier,cfg.secret,'sha256'),'hex')];
    for ix in 1..2 loop
      bucket_key=buckets[ix]; cap=case when ix=1 then 200 else 10 end;
      insert into evaluate_private.login_limits as limits(bucket,amount,window_start) values(bucket_key,1,now())
      on conflict(bucket) do update set amount=limits.amount+1 returning limits.amount into amount;
      if amount>cap then return evaluate_private.failure(429,'로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.'); end if;
    end loop;
    if role_name='evaluate' then
      select x into person from jsonb_array_elements(cfg.source->'people') x where x->>'id'=identifier;
      valid=person is not null and extensions.hmac(identifier,cfg.secret,'sha256')=extensions.hmac(supplied,cfg.secret,'sha256');
    else
      valid=identifier=cfg.admin_login and extensions.crypt(encode(extensions.digest(supplied,'sha256'),'hex'),cfg.admin_hash)=cfg.admin_hash;
    end if;
    if not valid then return evaluate_private.failure(401,'ID 또는 PW를 확인해 주세요.'); end if;
    delete from evaluate_private.login_limits where bucket=buckets[2];
    raw_token=encode(extensions.gen_random_bytes(32),'hex'); v_token_hash=encode(extensions.digest(raw_token,'sha256'),'hex');
    insert into evaluate_private.sessions(token_hash,role,employee,epoch,expires_at) values(v_token_hash,role_name,case when role_name='evaluate' then identifier else null end,cfg.epoch,now()+interval '3 hours');
    return evaluate_private.reply(200,jsonb_build_object('ok',true,'session',raw_token));
  end if;
  role_name=split_part(p_route,'/',3);
  v_token_hash=encode(extensions.digest(coalesce(p_session,''),'sha256'),'hex');
  select * into sess from evaluate_private.sessions s where s.token_hash=v_token_hash;
  if sess is null or sess.role<>role_name or sess.expires_at<now() then return evaluate_private.failure(401,'로그인이 필요합니다.'); end if;
  if sess.role='evaluate' and sess.epoch<>cfg.epoch then return evaluate_private.failure(401,'평가 결과가 초기화되었습니다. 다시 로그인해 주세요.'); end if;
  if p_route in ('/api/admin/logout','/api/evaluate/logout') then
    delete from evaluate_private.sessions s where s.token_hash=v_token_hash;
    return evaluate_private.reply(200,'{"ok":true}'::jsonb);
  end if;
  if sess.role='evaluate' then
    if p_route='/api/evaluate/session' then return evaluate_private.reply(200,evaluate_private.employee_view(sess.employee,sess.accepted)); end if;
    if p_route='/api/evaluate/acknowledge' then
      if p_body->>'notice_version' is distinct from cfg.source->>'notice_version' then return evaluate_private.failure(409,'안내를 다시 확인해 주세요.'); end if;
      update evaluate_private.sessions s set accepted=true where s.token_hash=v_token_hash;
      return evaluate_private.reply(200,evaluate_private.employee_view(sess.employee,true));
    end if;
    if p_route='/api/evaluate/submit' then
      view_data=evaluate_private.employee_view(sess.employee,sess.accepted);
      if not sess.accepted then return evaluate_private.failure(409,'평가 전 안내를 확인해 주세요.'); end if;
      if p_body->>'epoch' is distinct from cfg.epoch or p_body->>'assessment_version' is distinct from view_data->>'assessment_version' then return evaluate_private.failure(409,'평가 상태가 변경되었습니다. 새로고침해 주세요.'); end if;
      if (view_data->>'complete')::boolean then return evaluate_private.failure(409,'이미 제출한 평가입니다.'); end if;
      answers=p_body->'answers';
      if jsonb_typeof(answers) is distinct from 'object' then return evaluate_private.failure(400,'모든 문항에 답변해 주세요.'); end if;
      if (select count(*) from jsonb_object_keys(answers))<>jsonb_array_length(cfg.source->'questions') then return evaluate_private.failure(400,'모든 문항에 답변해 주세요.'); end if;
      for q in select jsonb_array_elements(cfg.source->'questions') loop
        raw_answer=answers->(q->>'id');
        if jsonb_typeof(raw_answer) is distinct from 'number' or coalesce(raw_answer::text,'')!~'^[0-9]{1,4}$' then return evaluate_private.failure(400,'선택할 수 없는 답변이 포함되어 있습니다.'); end if;
        ix=(raw_answer::text)::integer;
        if ix>=jsonb_array_length(q->'options') then return evaluate_private.failure(400,'선택할 수 없는 답변이 포함되어 있습니다.'); end if;
      end loop;
      dep=view_data->'person'->>'department';
      insert into evaluate_private.participation(department,employee_key) values(dep,encode(extensions.hmac(sess.employee,cfg.secret,'sha256'),'hex'));
      insert into evaluate_private.anonymous_responses(department,answers) values(dep,answers);
      for q in select jsonb_array_elements(cfg.source->'questions') loop
        insert into evaluate_private.counts as counts(department,question,choice,n) values(dep,q->>'id',(answers->>(q->>'id'))::integer,1)
        on conflict(department,question,choice) do update set n=counts.n+1;
      end loop;
      return evaluate_private.reply(200,'{"complete":true}'::jsonb);
    end if;
  elsif sess.role='admin' then
    if p_route='/api/admin/dashboard' then return evaluate_private.reply(200,evaluate_private.dashboard()); end if;
    if p_route='/api/admin/export' then
      result=evaluate_private.dashboard();
      select x into person from jsonb_array_elements(result->'departments') x where x->>'name'=p_body->>'department';
      if person is null then return evaluate_private.failure(404,'부서를 찾을 수 없습니다.'); end if;
      if not (person->>'unlocked')::boolean then return evaluate_private.failure(403,'부서 전원이 참여한 후 통계를 내려받을 수 있습니다.'); end if;
      select coalesce(jsonb_agg(r.answers order by r.response_id),'[]'::jsonb) into answers
        from evaluate_private.anonymous_responses r where r.department=person->>'name';
      amount=jsonb_array_length(answers);
      if amount>(person->>'completed')::integer then raise exception 'Anonymous response count mismatch'; end if;
      return evaluate_private.reply(200,person||jsonb_build_object('responses',answers,
        'response_count',amount,'unavailable_response_count',(person->>'completed')::integer-amount));
    end if;
    if p_route='/api/admin/reset-preview' then
      nonce=encode(extensions.gen_random_bytes(24),'hex');
      update evaluate_private.sessions s set reset_hash=encode(extensions.digest(nonce,'sha256'),'hex'),reset_expires=now()+interval '5 minutes',reset_epoch=cfg.epoch where s.token_hash=v_token_hash;
      return evaluate_private.reply(200,jsonb_build_object('token',nonce));
    end if;
    if p_route='/api/admin/reset' then
      if p_body->>'confirmation' is distinct from '정말로 초기화 하시겠습니까?' or sess.reset_hash is null or sess.reset_expires<now() or sess.reset_epoch<>cfg.epoch or sess.reset_hash<>encode(extensions.digest(coalesce(p_body->>'token',''),'sha256'),'hex') then return evaluate_private.failure(400,'초기화 확인창을 다시 열고 확인해 주세요.'); end if;
      delete from evaluate_private.participation; delete from evaluate_private.counts; delete from evaluate_private.anonymous_responses;
      delete from evaluate_private.sessions where role='evaluate';
      update evaluate_private.settings set epoch=gen_random_uuid()::text where singleton;
      update evaluate_private.sessions set reset_hash=null,reset_expires=null,reset_epoch=null;
      return evaluate_private.reply(200,'{"reset":true}'::jsonb);
    end if;
  end if;
  return evaluate_private.failure(404,'지원하지 않는 요청입니다.');
end;
$$;
revoke execute on all functions in schema evaluate_private from public,anon,authenticated;
revoke all on function public.evaluate_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.evaluate_api(text,jsonb,text,text) to service_role;
comment on function public.evaluate_api(text,jsonb,text,text) is 'Only the evaluate Edge Function service role may call this API. Custom role-specific opaque sessions are validated inside the transaction.';
notify pgrst,'reload schema';
commit;
