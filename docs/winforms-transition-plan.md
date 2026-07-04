## Plan: Electron to WinForms Transition

Electron 운영 안정화를 먼저 마무리한 뒤, UI만 WinForms로 단계 전환하고 Node/Express 백엔드는 최대한 재사용하는 전략이다. 이렇게 하면 전환 리스크를 줄이고 현장 운영 중단 없이 병행 배포가 가능하다.

**Steps**
1. Phase 0: 전환 기준선 확정
1.1 현재 Electron 기준선 버전을 고정하고(예: 1.0.9 이후 안정 패치만 허용), 신규 기능은 WinForms 백로그로 이관한다.  
1.2 데이터/운영 불변 조건을 고정한다: AppData 경로 유지, SQLite 데이터 유지, 기존 현장 자격증명 유지.  
1.3 WinForms 전환 범위를 확정한다: 유량검침, 수질분석, 약품/키트, 게시판/공지, 설정 중 운영 필수 항목.

2. Phase 1: 아키텍처 결정 (선행 게이트)
2.1 클라이언트 전략을 결정한다: A안(권장) WinForms 프런트만 교체 + Node/Express 백엔드 재사용, B안 C# 백엔드까지 동시 전환.  
2.2 배포 전략을 확정한다: 1순위 MSIX, 2순위 ClickOnce. 현장 오프라인/권한 제약을 반영해 최종 1개로 고정한다.  
2.3 그리드/입력 UX 기술 검증을 먼저 수행한다: DailyLog 성격의 대량 입력/편집 시나리오로 DataGridView 또는 서드파티 그리드 PoC를 완료한다.  
2.4 이 단계 완료 전에는 본 개발 착수 금지(게이트): 그리드 성능, 업데이트 체계, 설치 경로 정책이 통과해야 다음 단계 진행.

3. Phase 2: 공통 코어 분리 (병렬 가능)
3.1 API 계약서 고정: 현재 라우트 응답 스키마를 문서화하고 WinForms 클라이언트 SDK 레이어를 설계한다.  
3.2 인증/토큰/동기화 상태 모델을 분리한다(클라이언트 독립).  
3.3 파일/리포트 경로 정책을 고정한다(templates, uploads, AppData 하위 경로).  
3.4 병렬 작업: API 계약 문서화, 경로 정책 문서화, 배포 스크립트 초안은 서로 병렬 가능.

4. Phase 3: WinForms MVP 구현 (핵심 업무 우선)
4.1 로그인/권한/기본 셸(사이드바, 상단 상태영역) 구현.  
4.2 유량검침 모듈 구현(조회/입력/수정/검증).  
4.3 수질분석 모듈 구현(입력/이력/기본 통계).  
4.4 약품/키트 모듈 구현(재고, 사용량, 경고 임계치).  
4.5 게시판/공지 모듈 구현(목록/상세/첨부).  
4.6 설정 모듈은 운영 필수 패널만 1차 이관하고, 고급 설정은 Phase 4로 이월.  
4.7 의존 관계: 4.2~4.6은 4.1 완료 후 병렬 가능.

5. Phase 4: 고위험 기능 이관
5.1 일지/리포트(Excel/HWPX/PDF) 출력 플로우를 단계 이관한다.  
5.2 대량 입력 화면 성능 튜닝(가상화, 배치 저장, 셀 편집 최적화).  
5.3 동기화/백그라운드 작업 재시도 정책과 장애 복구 UX를 이관한다.

6. Phase 5: 배포/업데이트 체계 전환
6.1 WinForms 패키지 파이프라인(CI/CD) 구축 및 서명/무결성 검증 자동화.  
6.2 자동업데이트 정책 정의: 체크 주기, 설치 트리거(즉시/유휴/종료 시), 실패 시 롤백 정책.  
6.3 Electron과 WinForms 병행 배포 기간 운영(최소 2~3개월).

7. Phase 6: 병행 운영 및 컷오버
7.1 파일럿 현장(3~5곳) 우선 배포 후 장애율/업데이트 성공률/입력 생산성 지표 수집.  
7.2 임계치 통과 시 전체 현장 순차 전환.  
7.3 Electron은 보안/치명 버그 패치만 유지하다 종료 공지 후 EOL.

**Relevant files**
- AGENTS.md — 현재 아키텍처 보존 규칙, 변경 금지 구역, 검증 규칙 기준.
- package.json — Electron 빌드/퍼블리시/검증 스크립트 기준선.
- electron/main.cjs — 트레이/종료/IPC 진입점, 전환 시 제거 대상 경계.
- electron/updater.cjs — 현재 자동업데이트 정책(체크/다운로드/설치 트리거) 분석 기준.
- electron-builder.config.js — 현행 NSIS 배포 규칙, WinForms 배포 정책 비교 기준.
- server/index.cjs — Node/Express 서버 재사용 시 핵심 엔트리.
- server/database.cjs — 로컬 DB 스키마 및 마이그레이션 영향 분석 기준.
- server/routes — 클라이언트 교체 시 재사용 API 경계.
- server/services — 동기화/엑셀/드라이브/QnTECH 핵심 로직 재사용 영역.
- src/features — WinForms 이관 대상 기능 목록(우선순위 정의 입력).
- src/components/common/AdvancedDataGrid.jsx — WinForms 대체 난이도 최고 위험 포인트.
- docs/RELEASE_GUIDE.md — 현행 릴리즈 운영 절차, 전환 중 병행 운영 기준.
- scripts/build-integrated-installer.ps1 — 통합 설치 운영 요구사항 파악 기준.

**Verification**
1. Architecture Gate 검증
1.1 WinForms PoC에서 대량 입력 시나리오(현장 일지 수준 행 수) 성능 기준 통과 여부 측정.  
1.2 Node/Express 재사용 경로에서 주요 API(유량/수질/약품/게시판/설정) 계약 테스트 통과.
2. Deployment Gate 검증
2.1 선택한 배포 방식(MSIX 또는 ClickOnce)으로 신규 설치/업데이트/롤백 시나리오를 자동 테스트.  
2.2 현장 권한 제한 환경(일반 사용자 계정)에서 설치 및 업데이트 성공률 측정.
3. Data Gate 검증
3.1 기존 AppData/SQLite를 유지한 상태로 WinForms 첫 실행 마이그레이션 성공 검증.  
3.2 BigQuery/Drive/Firebase/QnTECH 연동 회귀 테스트 통과.
4. Pilot Gate 검증
4.1 파일럿 현장 2주 운영 후 치명 이슈 0건, 업데이트 성공률 95%+, 핵심 입력 작업 시간 기존 대비 악화 없음.

**Decisions**
- 포함 범위
유량검침, 수질분석, 약품/키트, 게시판/공지, 운영 필수 설정, 자동업데이트/배포 체계 전환.
- 제외 범위
초기 단계에서 고급 설정 콘솔 전체 이식, 대규모 UI 리브랜딩, 백엔드 전면 C# 재작성.
- 권장 결정
클라이언트 우선 전환(WinForms) + Node 백엔드 재사용 + 병행 운영 후 단계 폐기.

**Further Considerations**
1. 배포 방식 확정 필요
A안 MSIX(권장): 현대적 업데이트/무결성 강점.  
B안 ClickOnce: 구현 단순, 운영 제약 존재.
2. 그리드 라이브러리 확정 필요
A안 기본 DataGridView 커스텀(저비용, 튜닝 부담).  
B안 상용 그리드 도입(비용 증가, 개발 속도/안정성 향상).
3. 백엔드 전략 확정 필요
A안 Node 재사용(권장, 리스크 최소).  
B안 C# 동시 전환(일정/리스크 증가).
