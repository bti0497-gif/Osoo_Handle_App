# Osoo Handle App

휴게소 오수처리시설의 현장 업무를 로컬 우선으로 관리하는 Windows 데스크톱 앱입니다.

## 기술 구성

- React 19 + Vite
- Express + better-sqlite3
- Electron + electron-builder
- BigQuery, Google Drive/Sheets, Firebase 연동
- GitHub Releases 기반 자동 업데이트

## 개발 실행

```powershell
npm run dev:all
```

기본 로컬 서버 포트는 `18731~18734` 범위에서 자동 탐색합니다.

## 필수 검증

```powershell
npm run validate
npm run build
```

Electron 패키지 검증:

```powershell
npm run electron:build
npm run validate:asar
```

## 문서

- [개발 히스토리](docs/DEVELOPMENT_HISTORY.md)
- [향후 작업](docs/ROADMAP.md)
- [릴리스 가이드](docs/RELEASE_GUIDE.md)
- [릴리스 이후 유지보수](POST_RELEASE_MAINTENANCE_GUIDE.md)
- [레이아웃 계약](LAYOUT_CONTRACT.md)
- [백엔드 라우트 생성 지침](ROUTE_CREATION_GUIDE.md)
- [Google 계정 교체 가이드](GOOGLE_ACCOUNT_MIGRATION_GUIDE.md)

프로젝트 구조와 변경 제한은 반드시 [AGENTS.md](AGENTS.md)를 먼저 확인합니다.
