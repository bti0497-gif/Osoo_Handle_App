# 릴리스 이후 유지보수 지침

## 기본 원칙

- 현재 MVVM과 모듈 구조 안에서 작은 증분 변경으로 처리합니다.
- 현장별 차이는 코드보다 설정, 출력 템플릿과 매핑으로 흡수합니다.
- 일반 현장 업무 화면과 admin 설정 콘솔의 책임을 섞지 않습니다.
- 구조 리팩토링과 기능 변경은 한 작업에 섞지 않습니다.

## 변경 위치

- 설정 UI: `src/features/settings/panels/`, `widgets/`, `hooks/`
- 설정 API 업무 처리: `server/services/settings/`
- 현장 업무: 해당 `src/features/{domain}/`
- 출력 양식: `templates/reports/`
- 출력 처리: 관련 `server/services/`
- 동기화: 로컬 DB → BigQuery/Drive/Firebase 순서로 확인
- 사진: 로컬 저장 → Drive 업로드 → Drive 복구 순서로 확인

## 구조 규칙

- View에서 API를 직접 호출하지 않습니다.
- Model은 API 호출만 담당합니다.
- ViewModel은 상태와 업무 규칙을 담당합니다.
- Route는 요청과 응답 조정만 담당합니다.
- SQL, 외부 API, 파일 처리와 복잡한 권한 판단은 service로 분리합니다.
- 한 파일이 500줄 이상으로 커지거나 서로 다른 책임이 섞이면 새 기능을 얹기 전에 분리합니다.

## 현장 문제 분류

| 분류 | 확인 대상 |
|---|---|
| CONFIG | 현장, 공법, 항목, 매핑, 자격증명 |
| DATA | 로컬 DB 입력·수정·조회 |
| REPORT | 템플릿, 책갈피, 셀 매핑, PDF |
| SYNC | BigQuery, Drive, Firebase |
| PHOTO | 로컬 파일, 업로드, 복구 |
| UX | 화면 동선, 문구, 버튼, 스크롤 |
| BUILD | 설치파일, ASAR, 자동 업데이트 |

## 릴리스 검증

```powershell
npm run validate
npm run build
```

설치파일 배포 전에는 다음도 수행합니다.

```powershell
npm run electron:build
npm run validate:asar
```

자세한 절차는 `docs/RELEASE_GUIDE.md`를 따릅니다.

## 패키징/설정 경로 원칙

- 앱 런타임 설정의 기준 경로는 `%APPDATA%\Osoo_Handle_App\config`입니다.
- 기존 현장 설치와의 호환을 위해 `%APPDATA%\wastewater-treatment-plant\config`도 fallback으로 읽습니다.
- 설치/프로비저닝 스크립트는 `.env.local`, `google-key.json`, `bigquery-service-account.json`, `firebase-service-account.json`을 기준 경로에 반드시 복사하고, 호환 경로에도 함께 복사합니다.
- 자격증명 파일은 설치 패키지 본문에 포함하지 않고, 설치/프로비저닝 단계에서 사용자 AppData에 배치합니다.
- 릴리즈 전 `npm run validate`는 런타임 설정 경로 계약을 검증해야 하며, `npm run validate:asar`는 패키지 안에 자격증명이 포함되지 않았는지 확인해야 합니다.
- 현장 로그인 장애가 발생하면 먼저 `%APPDATA%\Osoo_Handle_App\config\.env.local`과 `%APPDATA%\Osoo_Handle_App\config\google-key.json` 존재 여부를 확인합니다.
