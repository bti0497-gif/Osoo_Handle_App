# Osoo Handle App Windows 7 x86 호환판

## 목적과 기준선

- 대상: Windows 7 32비트 PC 전용
- 최초 기준선: 일반판 `1.1.8`의 2026-07-21 기능
- 호환판 버전: `1.1.8-win7.1`부터 별도 관리
- 브랜치: `legacy/win7-ia32`
- 자동업데이트: 사용하지 않음
- 일반판 GitHub Release: 사용하지 않음

이 호환판은 일반판의 후속 변경을 자동으로 따라가지 않는다. 필요한 수정은 이 브랜치에서 선별하여 별도 버전으로 빌드한다.

## 호환성 고정 사항

- Electron `22.3.27` / ia32
- better-sqlite3 `8.7.0` / Electron ia32 ABI
- 이미지 처리는 Sharp 대신 Jimp 호환 계층 사용
- 게시판 HTML 정화 라이브러리는 Node 16 호환 버전으로 고정
- Windows 7에 없는 PowerShell 네트워크 cmdlet 대신 `netstat`와 `taskkill`로 전용 포트 정리
- 설치 제품명과 App ID를 일반판과 분리
- 현장 DB와 자격증명 호환을 위해 런타임 데이터 경로 `Osoo_Handle_App`은 유지

## 안전 릴리즈

```powershell
npm ci --ignore-scripts
$env:npm_config_arch = 'ia32'
node node_modules\electron\install.js
npx @electron/rebuild --force --arch=ia32 --version=22.3.27
npm run release:safe
```

`npm run validate`는 32비트 Electron 안에서 DB, 클린 서버 부팅, API 보안, 설정 저장, 통합입력 회귀검증을 수행한다. 일반 64비트 Node로 `better-sqlite3`를 직접 검사하면 정상적인 x86 모듈도 로드할 수 없으므로 전용 실행기를 사용한다.

## 현장 설치 전 확인

1. Windows 7 SP1 및 SHA-2 코드 서명 지원 업데이트가 설치되어 있어야 한다.
2. 기존 일반판과 동시에 실행하지 않는다. 두 판은 같은 현장 데이터 경로와 전용 포트를 사용한다.
3. 설치 직후 관리자 로그인, 설정 저장, 통합입력 저장, 일지 출력, 게시판 첨부를 실제 PC에서 확인한다.
4. 자동업데이트 버튼이나 일반판 릴리즈 연결이 나타나면 배포하지 않는다.

Windows 7 자체가 지원 종료된 운영체제이므로 이 빌드는 금왕휴게소 같은 불가피한 현장에 한정한다. 개발 PC의 x86 런타임 검증을 통과하더라도 최종 배포 전 실제 Windows 7 32비트 PC 시험이 필요하다.
