# 📋 배포 체크리스트 (Deployment Checklist)

각 버전 업데이트를 배포하기 전에 다음 항목들을 확인하세요.

## 🔄 빌드 & 검증 단계

### 1️⃣ 코드 변경 확인
- [ ] 모든 코드 변경 사항 검토 완료
- [ ] 신규 API 엔드포인트는 `server/api-spec.cjs`에 등록했나?
- [ ] 신규 라우트는 `server/routeRegistry.cjs`에 등록했나?
- [ ] API 변경이 있었다면 `CHANGELOG.md`에 기록했나?

```bash
# 예시: CHANGELOG.md 형식
## v1.0.1 - 2026-05-10
- 수정: 기본설정 메뉴 라우트 경로 오류 (GET /api/settings)
- 추가: Google Sheets 불가 시 로컬DB 폴백 (POST /api/settings/select-site)
- 수정: 설정 UI 그리드 레이아웃 안정화
```

### 2️⃣ 자동 검증
```bash
# 필수 파일 + 라우트 + API 스펙 검증
npm run validate

# (옵션) 개발 서버에서 API 테스트 (npm run dev가 실행 중이어야 함)
npm run validate:api

# (옵션) ASAR 패키지 검증 (빌드 후)
npm run validate:asar
```

**검증 항목:**
- ✅ `.env.local`, `google-key.json` 포함
- ✅ 모든 라우트 모듈 로드 가능
- ✅ API 스펙 유효성
- ✅ 필수 환경 변수 설정
- ✅ 엔드포인트 존재 여부

### 3️⃣ 버전 업데이트
```bash
# package.json 버전 업데이트 (예: 1.0.0 → 1.0.1)
# src/App.jsx의 APP_VERSION도 함께 업데이트

# Git 커밋
git add .
git commit -m "v1.0.1: 기본설정 메뉴 및 API 수정"
git tag v1.0.1
```

## 🏗️ 빌드 & 패키징

### 4️⃣ 안전한 빌드 실행
```bash
# 방법 1: 통합 검증 + 빌드 (권장)
npm run release:safe

# 방법 2: 수동 단계 실행
npm run build                    # Vite 빌드
npm run validate                 # 검증
npm run validate:api             # API 테스트 (npm run dev 실행 중)
npm run electron:build           # Electron 빌드
```

**빌드 결과 확인:**
- [ ] `dist/` 디렉토리 생성됨
- [ ] `release/` 디렉토리의 `.exe` 파일 생성됨
- [ ] 빌드 에러/경고 없음 (유효한 경고 제외)

### 5️⃣ 패키지 내용 검증
```bash
# ASAR 패키지 검증
npm run validate:asar
```

**필수 파일 확인:**
- [ ] `release/win-unpacked/resources/app.asar.unpacked/.env.local` 포함
- [ ] `release/win-unpacked/resources/app.asar.unpacked/server/config/google-key.json` 포함
- [ ] `release/win-unpacked/resources/app.asar.unpacked/server/routeRegistry.cjs` 포함
- [ ] `release/win-unpacked/resources/app.asar.unpacked/server/api-spec.cjs` 포함

## 🧪 수동 테스트 단계

### 6️⃣ 설치 & 기본 기능 테스트

```bash
# 1. 이전 버전 완전 제거
#    제어판 → 프로그램 제거 → "Osoo Handle App" 제거
#    또는: wmic product where name="Osoo Handle App" call uninstall /nointeractive

# 2. 새 버전 설치
.\release\Osoo\ Handle\ App\ Setup\ 1.0.0.exe

# 3. 설치 후 자동 실행되는 앱 테스트
```

**테스트 체크리스트:**
- [ ] **로그인**: 정상 로그인 가능
- [ ] **기본설정**: 기본설정 메뉴 열기 성공
- [ ] **현장 선택**: 현장명 드롭다운에서 목록 로드 성공
  - Google Sheets 연결 시: 시트에서 현장 목록 표시
  - Google Sheets 미연결 시: 로컬 DB에서 활성 현장만 표시
- [ ] **직원 관리**: 직원 목록 로드 성공
- [ ] **역할 관리**: 역할 목록 표시 정상
- [ ] **테마 설정**: 테마 변경 적용 정상
- [ ] **앱 버전**: 정상 표시
- [ ] **콘솔 에러**: 개발자 도구(F12) → Console에 에러 없음

### 7️⃣ 주요 기능 테스트

**흐름 관리:**
- [ ] 처리 흐름 조회 가능
- [ ] 신규 처리 흐름 생성 가능

**수질 데이터:**
- [ ] 수질 데이터 조회 가능
- [ ] 수질 사진 업로드 가능

**약품 관리:**
- [ ] 약품 목록 조회 가능
- [ ] 약품 입고 기록 가능

**일일 작업 로그:**
- [ ] 로그 저장 및 조회 가능
- [ ] 로그 내보내기(HWP) 가능

**데이터 내보내기:**
- [ ] Excel 내보내기 가능
- [ ] 데이터 정상 포함

## 📊 배포 후 모니터링

### 8️⃣ 배포 후 확인

**자동 업데이트:**
- [ ] 구글 드라이브에 `.exe` 파일 업로드 완료
- [ ] GitHub Releases에 버전 태그 생성 완료
- [ ] 다른 설치본에서 자동 업데이트 확인 (약 1시간 소요)

**사용자 보고:**
- [ ] 배포 공지 전송 완료
- [ ] 1주일 동안 에러 보고 모니터링

## 🚨 문제 발생 시 롤백

문제 발생 시:

```bash
# 1. 이전 버전 완전 제거
wmic product where name="Osoo Handle App" call uninstall /nointeractive

# 2. 이전 설치 파일(.exe) 실행
.\release-backup\Osoo\ Handle\ App\ Setup\ 1.0.0.exe

# 3. 이전 버전으로 되돌렸음을 사용자에게 공지

# 4. 버그 수정 후 다시 테스트 진행
```

## 📝 체크리스트 템플릿

각 배포마다 이 섹션을 복사하여 사용하세요:

```
# 배포 v1.0.X - YYYY-MM-DD

## 빌드 & 검증
- [ ] 코드 변경 검토
- [ ] API 스펙 업데이트
- [ ] npm run validate 통과
- [ ] npm run validate:api 통과
- [ ] 버전 및 CHANGELOG 업데이트
- [ ] Git 커밋 및 태그

## 패키징
- [ ] npm run release:safe 성공
- [ ] npm run validate:asar 성공
- [ ] .exe 파일 생성 확인

## 수동 테스트
- [ ] 설치 성공
- [ ] 로그인 및 기본 기능
- [ ] 현장 선택 및 데이터 로드
- [ ] 콘솔 에러 없음
- [ ] 주요 기능 동작 확인

## 배포
- [ ] Google Drive 업로드
- [ ] GitHub Releases 업데이트
- [ ] 사용자 공지

## 모니터링
- [ ] 자동 업데이트 확인 (1주)
- [ ] 사용자 에러 보고 모니터링
```

---

## 💡 팁

**빠른 검증:**
```bash
# 한 명령어로 모든 검증 실행 (npm run dev 필요)
npm run release:safe
```

**API 문제 디버깅:**
```bash
# 어느 API가 작동하지 않는지 확인
npm run dev                    # 터미널 1: 개발 서버 실행
npm run validate:api          # 터미널 2: API 검증
```

**ASAR 내용 확인 (Windows):**
```powershell
# ASAR 파일은 압축 아카이브이므로 7-Zip으로 열 수 있음
7z x "release/win-unpacked/resources/app.asar"
```

**환경 변수 확인:**
```bash
# .env.local에 필요한 변수가 모두 있는지 확인
cat .env.local | grep GOOGLE_MEMBERS_SHEET_ID
```

---

**마지막 확인:** 이 체크리스트를 따르면 과거의 패키징 오류(corrupted 파일, 누락된 모듈, 설정 파일 미포함)를 예방할 수 있습니다. 💪
