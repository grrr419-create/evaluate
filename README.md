# evaluate · 업무환경 심리평가

GitHub Pages의 정적 화면과 Supabase의 서버 함수·Postgres를 연결하는 평가 프로그램입니다. PC와 모바일에서 동일한 주소를 사용하며, 운영자의 PC를 켜 둘 필요가 없습니다.

## 화면과 동작

- 평가 화면: `index.html`. 사번으로 로그인한 뒤 안내를 확인하고 모든 문항에 응답합니다. 제출 확인창에서 최종 제출합니다.
- 관리자 화면: `admin.html`. 참여·미참여 명단을 확인하고, 부서 전원이 제출한 경우에만 해당 부서의 문항별 통계와 엑셀 다운로드를 제공합니다. 엑셀에는 취합 통계와 `응답 001`, `응답 002` 등의 익명 개별 응답 시트가 포함됩니다.
- 결과 초기화는 관리자 로그인과 확인창을 거쳐 실행합니다. 참여 기록·집계 결과·익명 개별 응답이 함께 초기화되고, 진행 중인 평가 세션도 만료됩니다.
- 문항·평가대상·안내는 설치 시 고정합니다. 이 버전에는 엑셀 업로드 기능이 없습니다. 원본 PC용 프로그램의 파일 자동 반영과는 별개입니다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `public/` | 수정할 화면 원본 |
| `docs/` | GitHub Pages 게시용 파일 |
| `supabase/functions/evaluate/index.ts` | 로그인·평가·관리자 API의 요청 처리 |
| `supabase/migrations/` | 비공개 데이터 구조, 권한, 트랜잭션, 익명 개별 응답 보관과 통계 공개 조건 |
| `tools/build.mjs` | 허용된 정적 파일만 `docs/`로 복사하는 빌드 |
| `tools/prepare-seed.mjs` | 로컬 비공개 자료로 최초 설치 SQL 생성 |
| `tests/` | 가상 대상자만 사용하는 검증 |
| `.private/` | 실제 명단·관리자 설정·설치 자료. Git 추적 제외 |

## 인증과 결과 저장

브라우저는 서비스 키를 사용하지 않습니다. 서버 함수가 로그인 정보를 검증하고 3시간 유효한 임의 세션을 발급합니다. 관리자와 평가자 권한을 구분하며, 로그인 실패 횟수를 제한합니다.

`evaluate_private` 스키마의 자료는 익명·일반 인증 역할에서 직접 조회할 수 없습니다. 외부 RPC 실행 권한은 `service_role`에만 부여하고, Edge Function에서 허용한 출처와 요청 형식을 검증한 뒤 데이터베이스에서 세션과 역할을 확인합니다. CORS는 로그인 인증을 대체하지 않습니다.

평가 결과는 부서·문항·선택지별 합계와 익명 답변 묶음으로 저장하며, 참여 표시는 별도로 관리합니다. 익명 답변 테이블에는 이름·사번·직위·제출 시각·참여 표시와 연결되는 키가 없습니다. 제출·집계·익명 답변 저장을 한 트랜잭션으로 처리합니다. 부서 구성원 전원이 참여하기 전에는 API에서도 통계와 다운로드를 거부합니다. 개별 답변은 관리자 다운로드 API에서만 제공하며, 시트 순서는 임의 UUID 정렬로 정해 참여자 명단이나 제출 순서와 무관합니다. 명단은 관리자 권한으로만 조회할 수 있습니다.

`202609030002_anonymous_response_export.sql` 적용 이전 제출은 합계만 보관되어 있어 개별 답변을 복원할 수 없습니다. 기존 참여 기록과 취합 통계를 그대로 보존하며, 엑셀의 `개별 응답 안내` 시트에서 전체 제출 수·개별 응답 시트 수·개별 답변 미보관 수를 구분합니다. 보관되지 않은 답변을 통계로부터 추정하거나 생성하지 않습니다.

## 설치·배포

1. Supabase에서 전용 `evaluate` 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/migrations/`의 SQL 파일을 파일명 순서대로 실행합니다. 이미 운영 중인 1.0 버전에는 `202609030002_anonymous_response_export.sql`만 추가 적용합니다. 초기 설치 SQL이나 결과 초기화를 다시 실행하지 않습니다.
3. 로컬 `.private/frozen-data.json`과 `.private/관리자설정.json`을 준비한 뒤 `node tools/prepare-seed.mjs`를 실행합니다. 생성한 `.private/install.sql`은 해당 Supabase 프로젝트의 SQL Editor에서 한 번 실행합니다. 같은 자료의 재실행은 무시하고, 다른 자료로 교체하는 실행은 거부합니다.
4. `supabase/functions/evaluate/index.ts`를 `evaluate` 함수로 배포합니다. `verify_jwt=false`로 설정하고, 함수 내부의 별도 세션 인증을 사용합니다.
5. 함수 환경 변수 `ALLOWED_ORIGINS`에 GitHub Pages의 출처(예: `https://ACCOUNT.github.io`)를 설정합니다. 기본 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 서버 환경에서만 사용합니다.
6. `public/config.json`의 `apiUrl`에 실제 함수 URL을 입력합니다.
7. `node tools/build.mjs`로 게시용 `docs/`를 만듭니다.
8. GitHub Pages의 게시 소스를 `main` 브랜치, `/docs` 폴더로 설정합니다.

계정 비밀번호, 원본 Excel, 개인별 명단, 설치 SQL, 데이터베이스 백업은 저장소나 Pages에 올리지 마세요. `.gitignore`와 빌드는 이 자료를 제외합니다. 게시할 때도 파일 목록을 확인합니다.

## 개발·검증

Node.js 22 이상에서:

```sh
npm install
npm test
npm run build
```

테스트는 PGlite의 실제 Postgres 엔진과 pgcrypto를 사용하며, 운영 프로젝트에 평가를 제출하거나 결과를 초기화하지 않습니다. 검증 대상은 권한 분리, 동시 중복 제출, 모든 문항의 유효성, 부서 완료 조건, 초기화 후 세션 무효화, 로그인 제한, CORS, 요청 크기 제한, XLSX 생성, 익명 개별 응답과 통계 일치, 기존 제출 보존과 마이그레이션 재실행입니다.

`node tools/preview.mjs`는 가상 명단만 사용하는 로컬 미리보기를 실행합니다. 출력된 주소에 접속하며 테스트 계정은 `tests/fixtures.mjs`에 정의되어 있습니다. 실제 Supabase 자료와 연결되지 않습니다.

GitHub Pages 안내: https://docs.github.com/en/pages/getting-started-with-github-pages
Supabase 요금제: https://supabase.com/pricing
