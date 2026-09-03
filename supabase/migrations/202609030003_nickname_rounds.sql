-- Nickname-only, one assessment round at a time. No roster is retained.
-- Existing submissions are preserved; resetting is a separate administrator action.
begin;
alter table evaluate_private.settings add column if not exists assessment_name text not null default '업무환경 심리평가';
alter table evaluate_private.settings add column if not exists legacy_count integer not null default 0 check(legacy_count>=0);
alter table evaluate_private.sessions add column if not exists admission_id uuid;
create table if not exists evaluate_private.admissions (
  admission_id uuid primary key default gen_random_uuid(),
  nickname text not null,
  nickname_key text not null unique,
  device_key text not null unique,
  complete boolean not null default false
);
create table if not exists evaluate_private.round_responses (
  response_id uuid primary key default gen_random_uuid(),
  nickname text not null,
  answers jsonb not null check(jsonb_typeof(answers)='object')
);
create table if not exists evaluate_private.legacy_counts (
  question text not null,
  choice integer not null check(choice>=0),
  n integer not null check(n>0),
  primary key(question,choice)
);
alter table evaluate_private.admissions enable row level security;
alter table evaluate_private.round_responses enable row level security;
alter table evaluate_private.legacy_counts enable row level security;
revoke all on all tables in schema evaluate_private from public,anon,authenticated;

do $$
declare cfg evaluate_private.settings; old_total integer; saved integer; q jsonb;
begin
  select * into cfg from evaluate_private.settings where singleton for update;
  if found and cfg.source->>'mode' is distinct from 'nickname' then
    select count(*) into old_total from evaluate_private.participation;
    insert into evaluate_private.round_responses(response_id,nickname,answers)
      select response_id,'기존 응답 '||lpad(row_number() over(order by response_id)::text,3,'0'),answers
      from evaluate_private.anonymous_responses;
    select count(*) into saved from evaluate_private.round_responses;
    if saved>old_total then raise exception 'Existing response count mismatch'; end if;
    if exists(
      select 1 from (select question,choice,sum(n) n from evaluate_private.counts group by question,choice) c
      full join (select a.key question,a.value::integer choice,count(*) n from evaluate_private.round_responses r,
        lateral jsonb_each_text(r.answers) a group by a.key,a.value::integer) r using(question,choice)
      where coalesce(c.n,0)<coalesce(r.n,0)
    ) then raise exception 'Existing aggregate count mismatch'; end if;
    insert into evaluate_private.legacy_counts(question,choice,n)
      select c.question,c.choice,(c.n-coalesce(r.n,0))::integer
      from (select question,choice,sum(n) n from evaluate_private.counts group by question,choice) c
      left join (select a.key question,a.value::integer choice,count(*) n from evaluate_private.round_responses r,
        lateral jsonb_each_text(r.answers) a group by a.key,a.value::integer) r using(question,choice)
      where c.n>coalesce(r.n,0);
    for q in select jsonb_array_elements(cfg.source->'questions') loop
      if (select coalesce(sum(n),0) from evaluate_private.legacy_counts where question=q->>'id')<>old_total-saved
        then raise exception 'Existing question totals mismatch'; end if;
    end loop;
    delete from evaluate_private.sessions where role='evaluate';
    delete from evaluate_private.login_limits;
    update evaluate_private.settings set legacy_count=old_total-saved,
      epoch=gen_random_uuid()::text,secret=encode(extensions.gen_random_bytes(32),'hex'),
      source=jsonb_build_object('mode','nickname','revision','nickname-v2','survey_version',cfg.source->>'survey_version',
        'questions',cfg.source->'questions','notice_version','nickname-notice-v2',
        'notice',E'업무환경 심리평가는 더 나은 근무환경을 만들기 위한 과정입니다.\n이름이나 사번 대신 본인을 알아볼 수 없는 닉네임을 사용해 주세요.\n관리자는 제출 인원과 통계, 닉네임별 답변을 확인할 수 있습니다.\n평소 느끼셨던 의견을 솔직하게 작성해 주세요.')
      where singleton;
  end if;
end $$;

drop function if exists evaluate_private.employee_view(text,boolean);
drop table if exists evaluate_private.participation;
drop table if exists evaluate_private.counts;
drop table if exists evaluate_private.anonymous_responses;
alter table evaluate_private.sessions drop column if exists employee;

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
  clean=jsonb_build_object('mode','nickname','revision',p_source->>'revision','questions',p_source->'questions',
    'survey_version',p_source->>'survey_version','notice',p_source->>'notice','notice_version',p_source->>'notice_version');
  insert into evaluate_private.settings(source,admin_login,admin_hash)
    values(clean,p_login,extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf',10)));
end $$;

create or replace function evaluate_private.nickname_view(p_admission uuid,p_accepted boolean)
returns jsonb language plpgsql set search_path='' as $$
declare cfg evaluate_private.settings; who evaluate_private.admissions;
begin
  select * into strict cfg from evaluate_private.settings where singleton;
  select * into strict who from evaluate_private.admissions where admission_id=p_admission;
  return jsonb_build_object('nickname',who.nickname,'name',cfg.assessment_name,
    'assessment_version',cfg.source->>'survey_version','notice',cfg.source->>'notice','notice_version',cfg.source->>'notice_version',
    'accepted',p_accepted,'complete',who.complete,'questions',case when p_accepted and not who.complete then cfg.source->'questions' else '[]'::jsonb end,
    'question_count',jsonb_array_length(cfg.source->'questions'),'epoch',cfg.epoch);
end $$;

create or replace function evaluate_private.dashboard()
returns jsonb language plpgsql set search_path='' as $$
declare cfg evaluate_private.settings; completed integer; stats jsonb='[]'; nums jsonb; q jsonb; ix integer; amount integer;
begin
  select * into strict cfg from evaluate_private.settings where singleton;
  select count(*)+cfg.legacy_count into completed from evaluate_private.round_responses;
  for q in select jsonb_array_elements(cfg.source->'questions') loop
    nums='[]';
    for ix in 0..jsonb_array_length(q->'options')-1 loop
      select count(*)+coalesce((select n from evaluate_private.legacy_counts where question=q->>'id' and choice=ix),0)
        into amount from evaluate_private.round_responses where (answers->>(q->>'id'))::integer=ix;
      nums=nums||jsonb_build_array(amount);
    end loop;
    if (select sum(n::integer) from jsonb_array_elements_text(nums) n)<>completed then raise exception 'Aggregate count mismatch'; end if;
    stats=stats||jsonb_build_array(q||jsonb_build_object('counts',nums));
  end loop;
  return jsonb_build_object('name',cfg.assessment_name,'completed',completed,'statistics',stats,
    'question_count',jsonb_array_length(cfg.source->'questions'),'epoch',cfg.epoch);
end $$;

create or replace function public.evaluate_api(p_route text,p_body jsonb default '{}'::jsonb,p_session text default '',p_client text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg evaluate_private.settings; sess evaluate_private.sessions; who evaluate_private.admissions;
  result jsonb; q jsonb; answers jsonb; raw_answer jsonb; ix integer; raw_token text; v_token_hash text;
  role_name text; identifier text; supplied text; device text; normalized text; nickname_hash text; device_hash text;
  buckets text[]; bucket_key text; amount integer; cap integer; nonce text; next_name text; saved integer; responses jsonb;
begin
  if jsonb_typeof(p_body) is distinct from 'object' then return evaluate_private.failure(400,'요청 형식이 올바르지 않습니다.'); end if;
  -- Serialize admission, submission, export and reset to prevent duplicate or cross-round writes.
  select * into cfg from evaluate_private.settings where singleton for update;
  if not found then return evaluate_private.failure(503,'평가 자료를 준비 중입니다. 관리자에게 문의해 주세요.'); end if;
  if p_route='/api/bootstrap' then return evaluate_private.reply(200,'{"ready":true}'::jsonb); end if;
  if p_route in ('/api/evaluate/login','/api/admin/login') then
    role_name=split_part(p_route,'/',3);
    if role_name='evaluate' then
      identifier=btrim(regexp_replace(pg_catalog.normalize(coalesce(p_body->>'nickname',''),'NFKC'),'[[:space:]]+',' ','g'));
      device=coalesce(p_body->>'device','');
      if length(identifier)<2 or length(identifier)>30 or identifier~'[[:cntrl:]]' or device!~'^[0-9a-f]{64}$'
        then return evaluate_private.failure(400,'닉네임은 2~30자로 입력해 주세요. 브라우저 저장 기능도 허용해 주세요.'); end if;
      normalized=lower(identifier);
      nickname_hash=encode(extensions.hmac('nickname:'||normalized,cfg.secret,'sha256'),'hex');
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
        if who.nickname_key<>nickname_hash then return evaluate_private.failure(409,'이 브라우저에서는 이미 다른 닉네임으로 참여했습니다. 처음 사용한 닉네임으로 접속해 주세요.'); end if;
      else
        if exists(select 1 from evaluate_private.admissions where nickname_key=nickname_hash)
          or exists(select 1 from evaluate_private.round_responses where lower(nickname)=normalized)
          then return evaluate_private.failure(409,'이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'); end if;
        insert into evaluate_private.admissions(nickname,nickname_key,device_key) values(identifier,nickname_hash,device_hash) returning * into who;
      end if;
      -- Reopening with the same browser and nickname resumes participation, with only one active session.
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
  if sess.role='evaluate' and sess.epoch<>cfg.epoch then return evaluate_private.failure(401,'새 평가가 시작되었습니다. 닉네임으로 다시 접속해 주세요.'); end if;
  if p_route in ('/api/admin/logout','/api/evaluate/logout') then
    delete from evaluate_private.sessions s where s.token_hash=v_token_hash;
    return evaluate_private.reply(200,'{"ok":true}'::jsonb);
  end if;
  if sess.role='evaluate' then
    if p_route='/api/evaluate/session' then return evaluate_private.reply(200,evaluate_private.nickname_view(sess.admission_id,sess.accepted)); end if;
    if p_route='/api/evaluate/acknowledge' then
      if p_body->>'notice_version' is distinct from cfg.source->>'notice_version' then return evaluate_private.failure(409,'안내를 다시 확인해 주세요.'); end if;
      update evaluate_private.sessions s set accepted=true where s.token_hash=v_token_hash;
      return evaluate_private.reply(200,evaluate_private.nickname_view(sess.admission_id,true));
    end if;
    if p_route='/api/evaluate/submit' then
      if not sess.accepted then return evaluate_private.failure(409,'평가 전 안내를 확인해 주세요.'); end if;
      if p_body->>'epoch' is distinct from cfg.epoch or p_body->>'assessment_version' is distinct from cfg.source->>'survey_version' then return evaluate_private.failure(409,'평가가 초기화되었습니다. 새 평가로 다시 접속해 주세요.'); end if;
      select * into strict who from evaluate_private.admissions where admission_id=sess.admission_id;
      if who.complete then return evaluate_private.failure(409,'이미 제출한 평가입니다.'); end if;
      answers=p_body->'answers';
      if jsonb_typeof(answers) is distinct from 'object' then return evaluate_private.failure(400,'모든 문항에 답변해 주세요.'); end if;
      if (select count(*) from jsonb_object_keys(answers))<>jsonb_array_length(cfg.source->'questions') then return evaluate_private.failure(400,'모든 문항에 답변해 주세요.'); end if;
      for q in select jsonb_array_elements(cfg.source->'questions') loop
        raw_answer=answers->(q->>'id');
        if jsonb_typeof(raw_answer) is distinct from 'number' or coalesce(raw_answer::text,'')!~'^[0-9]{1,4}$' then return evaluate_private.failure(400,'선택할 수 없는 답변이 포함되어 있습니다.'); end if;
        ix=(raw_answer::text)::integer;
        if ix>=jsonb_array_length(q->'options') then return evaluate_private.failure(400,'선택할 수 없는 답변이 포함되어 있습니다.'); end if;
      end loop;
      insert into evaluate_private.round_responses(nickname,answers) values(who.nickname,answers);
      update evaluate_private.admissions set complete=true where admission_id=who.admission_id;
      return evaluate_private.reply(200,'{"complete":true}'::jsonb);
    end if;
  elsif sess.role='admin' then
    if p_route='/api/admin/dashboard' then return evaluate_private.reply(200,evaluate_private.dashboard()); end if;
    if p_route='/api/admin/export' then
      result=evaluate_private.dashboard();
      if (result->>'completed')::integer=0 then return evaluate_private.failure(403,'제출된 평가가 없습니다.'); end if;
      select count(*),coalesce(jsonb_agg(jsonb_build_object('nickname',r.nickname,'answers',r.answers) order by r.response_id),'[]'::jsonb)
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
      next_name=btrim(regexp_replace(coalesce(p_body->>'name',''),'[[:space:]]+',' ','g'));
      if length(next_name)>60 or next_name~'[[:cntrl:]]' then return evaluate_private.failure(400,'평가 이름은 60자 이내로 입력해 주세요.'); end if;
      delete from evaluate_private.round_responses;
      delete from evaluate_private.sessions where role='evaluate';
      delete from evaluate_private.admissions;
      delete from evaluate_private.legacy_counts;
      delete from evaluate_private.login_limits;
      update evaluate_private.settings set epoch=gen_random_uuid()::text,secret=encode(extensions.gen_random_bytes(32),'hex'),legacy_count=0,
        assessment_name=coalesce(nullif(next_name,''),'업무환경 심리평가') where singleton;
      update evaluate_private.sessions set reset_hash=null,reset_expires=null,reset_epoch=null;
      return evaluate_private.reply(200,'{"reset":true}'::jsonb);
    end if;
  end if;
  return evaluate_private.failure(404,'지원하지 않는 요청입니다.');
end $$;
revoke execute on all functions in schema evaluate_private from public,anon,authenticated;
revoke all on function public.evaluate_api(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.evaluate_api(text,jsonb,text,text) to service_role;
comment on table evaluate_private.round_responses is 'Current-round nickname and answers only. No employee identity, IP, device token, timestamp or submission sequence.';
notify pgrst,'reload schema';
commit;
