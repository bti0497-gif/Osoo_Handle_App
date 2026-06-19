# Google 및 Firebase 계정 교체 가이드

## 런타임 설정 위치

배포 앱의 자격증명은 다음 경로에 둡니다.

```text
%APPDATA%\Osoo_Handle_App\config
```

주요 파일:

- `.env.local`
- `google-key.json`
- `bigquery-service-account.json`
- `firebase-service-account.json`
- 필요한 경우 `client_secret_*.json`

이 파일들은 Git과 설치 패키지에 포함하지 않습니다.

## 교체 절차

1. 공식 Google Cloud/Firebase 프로젝트와 서비스 계정을 준비합니다.
2. BigQuery, Sheets와 Drive에 필요한 권한을 부여합니다.
3. 공식 Google Sheets와 Drive 폴더 ID를 `.env.local`에 반영합니다.
4. Firebase Firestore와 서비스 계정을 준비합니다.
5. 현장별 안전한 폴더에 자격증명 묶음을 준비합니다.
6. 다음 명령으로 AppData에 복사합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\provision-runtime-config.ps1 -SourceDir <자격증명 폴더>
```

신규 설치는 `scripts/install-with-provisioning.cmd`를 사용합니다.

## 검증 순서

1. `npm run validate`
2. 로그인 및 현장 설정 조회
3. Google Sheets 현장/사용자 조회
4. BigQuery 읽기·쓰기
5. Drive 업로드와 복구
6. Firebase 게시글 조회·작성
7. 출력물 생성

## 롤백

문제가 발생하면 AppData의 자격증명 파일을 이전 정상본으로 되돌린 뒤 앱을 재시작합니다. 로컬 업무 입력은 유지하고 외부 동기화만 다시 검증합니다.
