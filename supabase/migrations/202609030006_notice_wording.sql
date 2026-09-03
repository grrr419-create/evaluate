-- Update only the requested notice sentence; keep questions and collected results.
begin;
update evaluate_private.settings
set source=source||jsonb_build_object(
  'notice',replace(source->>'notice','이름, 사번, 닉네임을 입력하지 않고 참여합니다.','개인정보를 입력하지 않고 참여합니다.'),
  'notice_version','device-notice-v2.1.1')
where singleton and position('이름, 사번, 닉네임을 입력하지 않고 참여합니다.' in source->>'notice')>0;
commit;
