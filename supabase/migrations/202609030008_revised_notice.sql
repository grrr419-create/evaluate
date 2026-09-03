-- Revise the participation notice without changing collected answers or access rules.
begin;
update evaluate_private.settings
set source=source||jsonb_build_object(
  'notice',E'업무환경 심리평가는 더 나은 근무환경을 함께 만들어가기 위한 과정입니다.\n본 평가는 개인정보를 입력하지 않고 참여하며, 관리자는 참여 인원과 전체 통계, 신원 정보가 없는 개별 답변을 확인할 수 있습니다.\n답변자를 특정할 수 없도록 운영되오니, 평소 느끼셨던 의견을 부담 없이 솔직하게 작성해 주시기 바랍니다.',
  'notice_version','device-notice-v2.2.1')
where singleton;
commit;
