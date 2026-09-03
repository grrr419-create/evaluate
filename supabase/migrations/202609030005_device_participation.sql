-- Button-only participation. Keep all answers, counts and current device participation.
-- Remove unused nickname identity fields; resets remain a separate administrator action.
begin;
select 1 from evaluate_private.settings where singleton for update;
alter table evaluate_private.admissions drop column if exists nickname_key;
alter table evaluate_private.admissions drop column if exists nickname;
alter table evaluate_private.round_responses drop column if exists nickname;
update evaluate_private.settings set source=source||jsonb_build_object('mode','device','notice_version','device-notice-v2.1','notice',E'업무환경 심리평가는 더 나은 근무환경을 만들기 위한 과정입니다.\n이름, 사번, 닉네임을 입력하지 않고 참여합니다.\n관리자는 참여 인원과 통계, 신원 정보가 없는 개별 답변을 확인할 수 있습니다.\n평소 느끼셨던 의견을 솔직하게 작성해 주세요.') where singleton and source->>'mode' is distinct from 'device';
create or replace function evaluate_private.install(p_source jsonb,p_login text,p_password text)
returns void language plpgsql set search_path='' as $$
declare existing jsonb; clean jsonb;
begin
  select source into existing from evaluate_private.settings where singleton;
  if found then
    if existing->>'revision'=p_source->>'revision' then return; end if;
    raise exception 'An assessment already exists. Use reset to start the next round.';
  end if;
  if jsonb_typeof(p_source->'questions') is distinct from 'array' or jsonb_array_length(p_source->'questions')<1
    or coalesce(p_source->>'survey_version','')='' or coalesce(p_source->>'notice_version','')=''
    or coalesce(p_login,'')='' or coalesce(p_password,'')='' then raise exception 'Invalid initial assessment'; end if;
  clean=jsonb_build_object('mode','device','revision',p_source->>'revision','questions',p_source->'questions',
    'survey_version',p_source->>'survey_version','notice',p_source->>'notice','notice_version',p_source->>'notice_version');
  insert into evaluate_private.settings(source,admin_login,admin_hash)
    values(clean,p_login,extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf',10)));
end $$;

create or replace function evaluate_private.participant_view(p_admission uuid,p_accepted boolean)
returns jsonb language plpgsql set search_path='' as $$
declare cfg evaluate_private.settings; who evaluate_private.admissions;
begin
  select * into strict cfg from evaluate_private.settings where singleton;
  select * into strict who from evaluate_private.admissions where admission_id=p_admission;
  return jsonb_build_object('name',cfg.assessment_name,
    'assessment_version',cfg.source->>'survey_version','notice',cfg.source->>'notice','notice_version',cfg.source->>'notice_version',
    'accepted',p_accepted,'complete',who.complete,'questions',case when p_accepted and not who.complete then cfg.source->'questions' else '[]'::jsonb end,
    'question_count',jsonb_array_length(cfg.source->'questions'),'epoch',cfg.epoch);
end $$;

create or replace function public.evaluate_api(p_route text,p_body jsonb default '{}'::jsonb,p_session text default '',p_client text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg evaluate_private.settings; sess evaluate_private.sessions; who evaluate_private.admissions;
  result jsonb; q jsonb; answers jsonb; raw_answer jsonb; ix integer; raw_token text; v_token_hash text;
  role_name text; identifier text; supplied text; device text; device_hash text;
  buckets text[]; bucket_key text; amount integer; cap integer; nonce text; saved integer; responses jsonb;
begin
  if jsonb_typeof(p_body) is distinct from 'object' then return evaluate_private.failure(400,'요청 형식이 올바르지 않습니다.'); end if;
  -- Serialize admission, submission, export and reset to prevent duplicate or cross-round writes.
  select * into cfg from evaluate_private.settings where singleton for update;
  if not found then return evaluate_private.failure(503,'평가 자료를 준비 중입니다. 관리자에게 문의해 주세요.'); end if;
  if p_route='/api/bootstrap' then return evaluate_private.reply(200,'{"ready":true}'::jsonb); end if;
  if p_route in ('/api/evaluate/login','/api/admin/login') then
    role_name=split_part(p_route,'/',3);
    if role_name='evaluate' then
      device=coalesce(p_body->>'device','');
      if device!~'^[0-9a-f]{64}$' then return evaluate_private.failure(400,'브라우저의 사이트 데이터 저장을 허용해 주세요.'); end if;
      device_hash=encode(extensions.hmac('device:'||device,cfg.secret,'sha256'),'hex');
    else
      identifier=btrim(coalesce(p_body->>'id','')); supplied=coalesce(p_body->>'password','');
      if length(identifier)>80 or length(supplied)>160 then return evaluate_private.failure(400,'입력 길이를 확인해 주세요.'); end if;
    end if;
    delete from evaluate_private.login_limits where window_start<now()-interval '15 minutes';
    delete from evaluate_private.sessions where expires_at<now();
    -- Shared office IPs may admit many browsers. IP is only an abuse limit, never a one-person identity.
    buckets=array[encode(extensions.hmac('ip:'||coalesce(p_client,''),cfg.secret,'sha256'),'hex'),
      encode(extensions.hmac(role_name||':'||case when role_name='evaluate' then device else identifier end,cfg.secret,'sha256'),'hex')];
    for ix in 1..2 loop
      bucket_key=buckets[ix]; cap=case when ix=1 then 200 else 15 end;
      insert into evaluate_private.login_limits as limits(bucket,amount,window_start) values(bucket_key,1,now())
        on conflict(bucket) do update set amount=limits.amount+1 returning limits.amount into amount;
      if amount>cap then return evaluate_private.failure(429,'접속 시도가 많습니다. 15분 후 다시 시도해 주세요.'); end if;
    end loop;
    if role_name='evaluate' then
      select * into who from evaluate_private.admissions where device_key=device_hash;
      if found then
        if who.complete then return evaluate_private.failure(409,'평가는 기기 당 1회 참여할 수 있습니다.'); end if;
      else
        insert into evaluate_private.admissions(device_key) values(device_hash) returning * into who;
      end if;
      -- Reopening an incomplete assessment reuses the admission and replaces its active session.
      delete from evaluate_private.sessions where admission_id=who.admission_id;
    elsif identifier<>cfg.admin_login or extensions.crypt(encode(extensions.digest(supplied,'sha256'),'hex'),cfg.admin_hash)<>cfg.admin_hash then
      return evaluate_private.failure(401,'ID 또는 PW를 확인해 주세요.');
    end if;
    delete from evaluate_private.login_limits where bucket=buckets[2];
    raw_token=encode(extensions.gen_random_bytes(32),'hex'); v_token_hash=encode(extensions.digest(raw_token,'sha256'),'hex');
    insert into evaluate_private.sessions(token_hash,role,admission_id,epoch,expires_at)
      values(v_token_hash,role_name,case when role_name='evaluate' then who.admission_id else null end,cfg.epoch,now()+interval '3 hours');
    return evaluate_private.reply(200,jsonb_build_object('ok',true,'session',raw_token));
  end if;
  role_name=split_part(p_route,'/',3);
  v_token_hash=encode(extensions.digest(coalesce(p_session,''),'sha256'),'hex');
  select * into sess from evaluate_private.sessions s where s.token_hash=v_token_hash;
  if sess is null or sess.role<>role_name or sess.expires_at<now() then return evaluate_private.failure(401,'다시 접속해 주세요. 평가가 초기화되었거나 접속이 만료되었습니다.'); end if;
  if sess.role='evaluate' and sess.epoch<>cfg.epoch then return evaluate_private.failure(401,'새 평가가 시작되었습니다. 평가 참여하기를 눌러 다시 접속해 주세요.'); end if;
  if p_route in ('/api/admin/logout','/api/evaluate/logout') then
    delete from evaluate_private.sessions s where s.token_hash=v_token_hash;
    return evaluate_private.reply(200,'{"ok":true}'::jsonb);
  end if;
  if sess.role='evaluate' then
    if p_route='/api/evaluate/session' then return evaluate_private.reply(200,evaluate_private.participant_view(sess.admission_id,sess.accepted)); end if;
    if p_route='/api/evaluate/acknowledge' then
      if p_body->>'notice_version' is distinct from cfg.source->>'notice_version' then return evaluate_private.failure(409,'안내를 다시 확인해 주세요.'); end if;
      update evaluate_private.sessions s set accepted=true where s.token_hash=v_token_hash;
      return evaluate_private.reply(200,evaluate_private.participant_view(sess.admission_id,true));
    end if;
    if p_route='/api/evaluate/submit' then
      if not sess.accepted then return evaluate_private.failure(409,'평가 전 안내를 확인해 주세요.'); end if;
      if p_body->>'epoch' is distinct from cfg.epoch or p_body->>'assessment_version' is distinct from cfg.source->>'survey_version' then return evaluate_private.failure(409,'평가가 초기화되었습니다. 새 평가로 다시 접속해 주세요.'); end if;
      select * into strict who from evaluate_private.admissions where admission_id=sess.admission_id;
      if who.complete then return evaluate_private.failure(409,'평가는 기기 당 1회 참여할 수 있습니다.'); end if;
      answers=p_body->'answers';
      if jsonb_typeof(answers) is distinct from 'object' then return evaluate_private.failure(400,'모든 문항에 답변해 주세요.'); end if;
      if (select count(*) from jsonb_object_keys(answers))<>jsonb_array_length(cfg.source->'questions') then return evaluate_private.failure(400,'모든 문항에 답변해 주세요.'); end if;
      for q in select jsonb_array_elements(cfg.source->'questions') loop
        raw_answer=answers->(q->>'id');
        if jsonb_typeof(raw_answer) is distinct from 'number' or coalesce(raw_answer::text,'')!~'^[0-9]{1,4}$' then return evaluate_private.failure(400,'선택할 수 없는 답변이 포함되어 있습니다.'); end if;
        ix=(raw_answer::text)::integer;
        if ix>=jsonb_array_length(q->'options') then return evaluate_private.failure(400,'선택할 수 없는 답변이 포함되어 있습니다.'); end if;
      end loop;
      insert into evaluate_private.round_responses(answers) values(answers);
      update evaluate_private.admissions set complete=true where admission_id=who.admission_id;
      return evaluate_private.reply(200,'{"complete":true}'::jsonb);
    end if;
  elsif sess.role='admin' then
    if p_route='/api/admin/dashboard' then return evaluate_private.reply(200,evaluate_private.dashboard()); end if;
    if p_route='/api/admin/export' then
      result=evaluate_private.dashboard();
      if (result->>'completed')::integer=0 then return evaluate_private.failure(403,'제출된 평가가 없습니다.'); end if;
      select count(*),coalesce(jsonb_agg(jsonb_build_object('answers',r.answers) order by r.response_id),'[]'::jsonb)
        into saved,responses from evaluate_private.round_responses r;
      return evaluate_private.reply(200,result||jsonb_build_object('responses',responses,'response_count',saved,'unavailable_response_count',cfg.legacy_count));
    end if;
    if p_route='/api/admin/reset-preview' then
      nonce=encode(extensions.gen_random_bytes(24),'hex');
      update evaluate_private.sessions s set reset_hash=encode(extensions.digest(nonce,'sha256'),'hex'),reset_expires=now()+interval '5 minutes',reset_epoch=cfg.epoch where s.token_hash=v_token_hash;
      return evaluate_private.reply(200,jsonb_build_object('token',nonce));
    end if;
    if p_route='/api/admin/reset' then
      if p_body->>'confirmation' is distinct from '정말로 초기화 하시겠습니까?' or sess.reset_hash is null or sess.reset_expires<now() or sess.reset_epoch<>cfg.epoch or sess.reset_hash<>encode(extensions.digest(coalesce(p_body->>'token',''),'sha256'),'hex') then return evaluate_private.failure(400,'초기화 확인창을 다시 열고 확인해 주세요.'); end if;
      delete from evaluate_private.round_responses where response_id is not null;
      delete from evaluate_private.sessions where role='evaluate';
      delete from evaluate_private.admissions where admission_id is not null;
      delete from evaluate_private.legacy_counts where question is not null;
      delete from evaluate_private.login_limits where bucket is not null;
      update evaluate_private.settings set epoch=gen_random_uuid()::text,secret=encode(extensions.gen_random_bytes(32),'hex'),legacy_count=0,
        assessment_name='업무환경 심리평가' where singleton;
      update evaluate_private.sessions set reset_hash=null,reset_expires=null,reset_epoch=null where role='admin';
      return evaluate_private.reply(200,'{"reset":true}'::jsonb);
    end if;
  end if;
  return evaluate_private.failure(404,'지원하지 않는 요청입니다.');
end $$;
drop function if exists evaluate_private.nickname_view(uuid,boolean);
revoke execute on all functions in schema evaluate_private from public,anon,authenticated;
revoke all on function public.evaluate_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.evaluate_api(text,jsonb,text,text) to service_role;
notify pgrst,'reload schema';
commit;
