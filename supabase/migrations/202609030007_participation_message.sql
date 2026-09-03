-- Change only the duplicate-participation message, preserving API behavior and privileges.
begin;
do $$
declare definition text;
begin
  select pg_get_functiondef('public.evaluate_api(text,jsonb,text,text)'::regprocedure) into definition;
  if position('평가는 기기 당 1회 참여할 수 있습니다.' in definition)>0 then
    execute replace(definition,'평가는 기기 당 1회 참여할 수 있습니다.','평가는 1회 참여할 수 있습니다.');
  elsif position('평가는 1회 참여할 수 있습니다.' in definition)=0 then
    raise exception 'Expected participation message was not found';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
