-- Clarify that the administrator sees a participant count, not a participant roster.
begin;
update evaluate_private.settings
set source=source||jsonb_build_object(
  'notice',replace(source->>'notice','참여 인원과','참여 인원수와'),
  'notice_version','device-notice-v2.2.2')
where singleton and position('참여 인원과' in source->>'notice')>0;
commit;
