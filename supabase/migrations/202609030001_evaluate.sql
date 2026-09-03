-- No roster, passwords, or responses are included in this migration.
-- The only API entry point is executable by the Edge Function's service role.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists evaluate_private;
revoke all on schema evaluate_private from public, anon, authenticated;

create table if not exists evaluate_private.settings (
  singleton boolean primary key default true check (singleton),
  epoch text not null default gen_random_uuid()::text,
  secret text not null default encode(extensions.gen_random_bytes(32),'hex'),
  source jsonb not null,
  admin_login text not null,
  admin_hash text not null
);
create table if not exists evaluate_private.sessions (
  token_hash text primary key,
  role text not null check(role in ('admin','evaluate')),
  employee text,
  epoch text not null,
  expires_at timestamptz not null,
  accepted boolean not null default false,
  reset_hash text,
  reset_expires timestamptz,
  reset_epoch text
);
create table if not exists evaluate_private.participation (
  department text not null,
  employee_key text primary key
);
create table if not exists evaluate_private.counts (
  department text not null,
  question text not null,
  choice integer not null check(choice>=0),
  n integer not null check(n>0),
  primary key(department,question,choice)
);
create table if not exists evaluate_private.login_limits (
  bucket text primary key,
  amount integer not null,
  window_start timestamptz not null
);
alter table evaluate_private.settings enable row level security;
alter table evaluate_private.sessions enable row level security;
alter table evaluate_private.participation enable row level security;
alter table evaluate_private.counts enable row level security;
alter table evaluate_private.login_limits enable row level security;
revoke all on all tables in schema evaluate_private from public,anon,authenticated;

create or replace function evaluate_private.reply(p_status integer,p_data jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('status',p_status,'data',p_data);
$$;
create or replace function evaluate_private.failure(p_status integer,p_message text)
returns jsonb language sql immutable set search_path='' as $$
  select evaluate_private.reply(p_status,jsonb_build_object('error',p_message));
$$;
create or replace function evaluate_private.install(p_source jsonb,p_login text,p_password text)
returns void language plpgsql set search_path='' as $$
declare v_existing jsonb;
begin
  select source into v_existing from evaluate_private.settings where singleton;
  if found then
    if v_existing->>'revision'=p_source->>'revision' then return; end if;
    raise exception 'Frozen assessment already exists. Importing a different roster or survey is not allowed.';
  end if;
  if jsonb_typeof(p_source->'people') is distinct from 'array' or jsonb_array_length(p_source->'people')<1
    or jsonb_typeof(p_source->'questions') is distinct from 'array' or jsonb_array_length(p_source->'questions')<1
    or coalesce(p_login,'')='' or coalesce(p_password,'')='' then raise exception 'Invalid initial assessment'; end if;
  if (select count(*) from jsonb_array_elements(p_source->'people'))<>(select count(distinct x->>'id') from jsonb_array_elements(p_source->'people') x) then raise exception 'Duplicate employee IDs'; end if;
  insert into evaluate_private.settings(source,admin_login,admin_hash)
  values(p_source,p_login,extensions.crypt(encode(extensions.digest(p_password,'sha256'),'hex'),extensions.gen_salt('bf',10)));
end;
$$;

create or replace function evaluate_private.employee_view(p_employee text,p_accepted boolean)
returns jsonb language plpgsql set search_path='' as $$
declare cfg evaluate_private.settings; person jsonb; done boolean;
begin
  select * into strict cfg from evaluate_private.settings where singleton;
  select x into person from jsonb_array_elements(cfg.source->'people') x where x->>'id'=p_employee;
  if person is null then return null; end if;
  select exists(select 1 from evaluate_private.participation where employee_key=encode(extensions.hmac(p_employee,cfg.secret,'sha256'),'hex')) into done;
  return jsonb_build_object('person',person,'assessment_version',cfg.source->'cohorts'->>(person->>'department'),
    'survey_version',cfg.source->>'survey_version','notice',cfg.source->>'notice','notice_version',cfg.source->>'notice_version',
    'accepted',p_accepted,'complete',done,'questions',case when p_accepted and not done then cfg.source->'questions' else '[]'::jsonb end,
    'question_count',jsonb_array_length(cfg.source->'questions'),'epoch',cfg.epoch);
end;
$$;

create or replace function evaluate_private.dashboard()
returns jsonb language plpgsql set search_path='' as $$
declare cfg evaluate_private.settings; dep text; person jsonb; q jsonb; departments jsonb='[]'; participants jsonb='[]'; stats jsonb; nums jsonb; done boolean; total integer; completed integer; all_completed integer=0; ix integer; amount integer; sum_answers integer;
begin
  select * into strict cfg from evaluate_private.settings where singleton;
  for dep in select jsonb_array_elements_text(cfg.source->'departments') loop
    total=0; completed=0;
    for person in select x from jsonb_array_elements(cfg.source->'people') x where x->>'department'=dep loop
      total=total+1;
      select exists(select 1 from evaluate_private.participation where employee_key=encode(extensions.hmac(person->>'id',cfg.secret,'sha256'),'hex')) into done;
      if done then completed=completed+1; end if;
      participants=participants||jsonb_build_array(person||jsonb_build_object('complete',done));
    end loop;
    stats=null;
    if total>0 and total=completed then
      stats='[]';
      for q in select jsonb_array_elements(cfg.source->'questions') loop
        nums='[]'; sum_answers=0;
        for ix in 0..jsonb_array_length(q->'options')-1 loop
          select coalesce((select n from evaluate_private.counts where department=dep and question=q->>'id' and choice=ix),0) into amount;
          nums=nums||jsonb_build_array(amount); sum_answers=sum_answers+amount;
        end loop;
        if sum_answers<>total then raise exception 'Aggregate count mismatch'; end if;
        stats=stats||jsonb_build_array(q||jsonb_build_object('counts',nums));
      end loop;
    end if;
    departments=departments||jsonb_build_array(jsonb_build_object('name',dep,'total',total,'completed',completed,'pending',total-completed,'unlocked',total>0 and total=completed,'statistics',stats));
    all_completed=all_completed+completed;
  end loop;
  return jsonb_build_object('departments',departments,'participants',participants,'total',jsonb_array_length(cfg.source->'people'),
    'completed',all_completed,'question_count',jsonb_array_length(cfg.source->'questions'),'revision',cfg.source->>'revision','epoch',cfg.epoch);
end;
$$;

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
      return evaluate_private.reply(200,person);
    end if;
    if p_route='/api/admin/reset-preview' then
      nonce=encode(extensions.gen_random_bytes(24),'hex');
      update evaluate_private.sessions s set reset_hash=encode(extensions.digest(nonce,'sha256'),'hex'),reset_expires=now()+interval '5 minutes',reset_epoch=cfg.epoch where s.token_hash=v_token_hash;
      return evaluate_private.reply(200,jsonb_build_object('token',nonce));
    end if;
    if p_route='/api/admin/reset' then
      if p_body->>'confirmation' is distinct from '정말로 초기화 하시겠습니까?' or sess.reset_hash is null or sess.reset_expires<now() or sess.reset_epoch<>cfg.epoch or sess.reset_hash<>encode(extensions.digest(coalesce(p_body->>'token',''),'sha256'),'hex') then return evaluate_private.failure(400,'초기화 확인창을 다시 열고 확인해 주세요.'); end if;
      delete from evaluate_private.participation; delete from evaluate_private.counts;
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
