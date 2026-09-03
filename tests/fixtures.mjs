export const fixture={mode:'device',revision:'fixture-v2',survey_version:'fixture-survey',notice_version:'fixture-notice',notice:'검증용 안내입니다.',questions:[{id:'question-a',text:'검증용 문항 A',options:['예','아니오']},{id:'question-b',text:'검증용 문항 B',options:['동의','보통','비동의']}]};
// Fictional legacy identities verify that migration removes the old roster.
export const legacyFixture={...fixture,mode:'employee',revision:'fixture-v1',departments:['검증부서 A','검증부서 B'],cohorts:{'검증부서 A':'cohort-a','검증부서 B':'cohort-b'},people:[{id:'TEST-A1',name:'검증자 가',position:'사원',department:'검증부서 A'},{id:'TEST-A2',name:'검증자 나',position:'과장',department:'검증부서 A'},{id:'TEST-B1',name:'검증자 다',position:'대리',department:'검증부서 B'}]};
export const fixtureAdmin={id:'fixture-admin',password:'fixture-admin-only'};
