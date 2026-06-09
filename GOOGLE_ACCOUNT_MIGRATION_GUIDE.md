# Google 계정/프로젝트 교체 가이드

현재 개발 중에는 개인 Google 계정과 개발용 Google Cloud/Firebase 리소스를 사용할 수 있지만, 최초 릴리즈 또는 운영 안정화 시점에는 회사 공식 계정으로 전환될 수 있다. 이 문서는 계정 교체 시 코드 수정을 최소화하고 설정 교체와 검증만으로 전환하기 위한 기준이다.

## 교체 대상

- Google Cloud 서비스 계정 JSON: `server/config/google-key.json`
- BigQuery 프로젝트/데이터셋: `BIGQUERY_DATASET_ID` 및 서비스 계정 권한
- Google Sheets 현장/회원 마스터: `GOOGLE_MEMBERS_SHEET_ID`
- Google Drive 루트 폴더: `GOOGLE_DRIVE_FOLDER_ID`
- Google Drive OAuth/서비스 계정 인증 값: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_REDIRECT_URI`
- Firebase Firestore 서비스 계정: `server/config/firebase-service-account.json`
- 소통게시판 백엔드 선택: `BOARD_BACKEND`
- 자동 업데이트 배포 계정/저장소: GitHub Releases 설정

## 구조 원칙

- 계정/프로젝트 교체 때문에 feature View, ViewModel, route 파일을 직접 수정하지 않는다.
- Google/Firebase 연결 정보는 `.env.local`과 `server/config/*.json`으로 분리한다.
- Google API 호출 로직은 `server/services/` 안의 서비스 파일에만 둔다.
- 새 Google 연동 기능은 라우트에 직접 구현하지 않고 `server/services/{domain}Service.cjs`로 분리한다.
- 공식 계정 전환 전후에 개발 계정 데이터와 운영 계정 데이터를 섞지 않는다.

## 교체 절차

1. 회사 공식 Google Cloud 프로젝트를 생성한다.
2. BigQuery 데이터셋과 필요한 테이블을 생성하거나 초기화 스크립트로 준비한다.
3. 회사 공식 서비스 계정을 만들고 BigQuery, Sheets, Drive 권한을 부여한다.
4. 새 서비스 계정 JSON을 `server/config/google-key.json`으로 교체한다.
5. 회원/현장 관리용 Google Sheets 파일을 만들고 서비스 계정 이메일에 편집 권한을 부여한다.
6. `.env.local`의 `GOOGLE_MEMBERS_SHEET_ID`를 회사 공식 Sheets ID로 교체한다.
7. Drive 루트 폴더를 만들고 `.env.local`의 `GOOGLE_DRIVE_FOLDER_ID`를 교체한다.
8. Drive 인증 방식이 OAuth이면 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_REDIRECT_URI`를 공식 계정 값으로 교체한다.
9. Firebase 프로젝트를 회사 공식 계정으로 생성하고 Firestore를 활성화한다.
10. Firebase Admin SDK 키를 `server/config/firebase-service-account.json`으로 교체한다.
11. `.env.local`의 `BOARD_BACKEND=firebase` 설정을 확인한다.
12. 필요하면 GitHub Releases 저장소/토큰/배포 권한을 회사 계정 기준으로 교체한다.

## 전환 후 검증

아래 순서대로 확인한다.

1. `npm run validate`
2. admin 로그인
3. 설정 메뉴에서 현장/현장관리자 저장
4. 현장관리자 로그인/로그아웃 출결 기록
5. 유량 입력 후 로컬 DB 저장 확인
6. BigQuery 백그라운드 업로드 확인
7. 약품/키트/슬러지 사진 로컬 저장 확인
8. Drive 업로드 확인
9. Drive 사진 복구 메시지 흐름 확인
10. 소통게시판 작성/조회가 Firebase Firestore에 반영되는지 확인
11. 일지/대장 Excel 출력 확인
12. 성적서 PDF 다운로드 확인

## 롤백 기준

- BigQuery 업로드가 실패하면 `.env.local`과 `server/config/google-key.json`을 이전 개발 계정 값으로 되돌린 뒤 서버를 재시작한다.
- 소통게시판 Firebase 문제가 발생하면 `BOARD_BACKEND=bigquery`로 임시 롤백할 수 있다.
- Drive 업로드가 실패해도 로컬 저장은 유지되어야 하며, Drive 설정만 재점검한다.
- 계정 교체 중 데이터가 섞이면 업로드 시각과 site_id/site_name 기준으로 BigQuery에서 정리한다.

## 개발 시 주의

- 개인 계정 전용 값은 코드에 직접 쓰지 않는다.
- 서비스 계정 JSON은 Git에 커밋하지 않는다.
- `.env.local` 값 변경만으로 전환 가능하게 유지한다.
- 계정 전환과 기능 리팩토링은 같은 커밋에 섞지 않는다.
