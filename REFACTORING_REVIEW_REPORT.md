# 리팩토링 후 최종 점검 보고서

> **점검일**: 2026-06-12  
> **대상**: 로그인 → 로컬DB 캐싱 → 각 메뉴 업무(유량/약품/수질/키트) → 출결 빅쿼리 동기화  
> **방법**: 코드 정적 분석 (프론트엔드 + 백엔드 전수 추적)

---

## 점검 요약

| 심각도 | 건수 | 설명 |
|--------|------|------|
| 🔴 심각 (기능 오류) | 3건 | 재고 계산 누락, 날짜 불일치, admin 세션 비저장 후 속성 접근 오류 |
| 🟡 중간 (잠재적 문제) | 5건 | 미사용 임포트, 프리로드 캐시 사이트 전환 시 잔류, 자동저장 타이머 등 |
| 🟢 낮음 (개선 권장) | 4건 | 코드 품질, 일관성, DriveSyncService stub 등 |

---

## 🔴 심각 (기능 오류) — 3건

### S-1. `medicineInRoutes.cjs` — 입고 저장 시 재고 연쇄 재계산 누락

> [!CAUTION]
> 약품입고일지(`/api/medicine-in/save`)에서 약품/키트 입고량을 upsert할 때 **재고 연쇄 재계산 함수를 호출하지 않습니다.**

**현상**: 약품입고일지에서 입고량을 저장하면 `medicine_logs` 또는 `kit_logs`의 `purchase_amount`만 갱신되고, 해당일부터의 `current_inventory`는 갱신되지 않음.

**영향**: 약품관리/키트관리 그리드에서 재고 수량이 실제와 다르게 표시됨.

**위치**: [medicineInRoutes.cjs](file:///e:/Wastewater%20Treatment%20Plant/server/routes/medicineInRoutes.cjs#L336-L413)

**비교 대상**:
- [medicineRoutes.cjs](file:///e:/Wastewater%20Treatment%20Plant/server/routes/medicineRoutes.cjs#L60-L111) `/api/medicines/bulk` — `recalculateMedicineInventory()` 호출 ✅
- [medicineRoutes.cjs](file:///e:/Wastewater%20Treatment%20Plant/server/routes/medicineRoutes.cjs#L114-L173) `/api/medicines/purchase` — `recalculateMedicineInventory()` 호출 ✅
- [kitRoutes.cjs](file:///e:/Wastewater%20Treatment%20Plant/server/routes/kitRoutes.cjs#L101-L152) `/api/kits/bulk` — `recalculateKitInventory()` 호출 ✅
- **[medicineInRoutes.cjs](file:///e:/Wastewater%20Treatment%20Plant/server/routes/medicineInRoutes.cjs#L336-L413) `/api/medicine-in/save` — 재계산 호출 없음** ❌

**수정 방법**:
```diff
 // medicineInRoutes.cjs의 /api/medicine-in/save 핸들러 내부
 // db.transaction(...)(items) 직후에 추가:

 +const { recalculateMedicineInventory } = require('./medicineRoutes.cjs에서 분리 또는 직접 정의');
 +// 또는 medicineRoutes.cjs의 recalculateMedicineInventory를 공통 서비스로 분리하여 import

  if (tab === 'medicine') {
    // ... 기존 upsert 트랜잭션 ...
 +  const affectedNames = new Set(items.filter(i => i.name).map(i => i.name));
 +  db.transaction(() => {
 +    for (const name of affectedNames) {
 +      recalculateMedicineInventory(db, name, metadata);
 +    }
 +  })();
  } else if (tab === 'kit') {
    // ... 기존 upsert 트랜잭션 ...
 +  const affectedKits = new Set(items.filter(i => i.name).map(i => i.name));
 +  db.transaction(() => {
 +    for (const kitName of affectedKits) {
 +      recalculateKitInventory(db, kitName, metadata);
 +    }
 +  })();
  }
```

> [!IMPORTANT]
> `recalculateMedicineInventory`와 `recalculateKitInventory`는 현재 각각 `medicineRoutes.cjs`와 `kitRoutes.cjs`에 **모듈 내부 함수**로 정의되어 있어 외부에서 접근 불가. 공통 서비스(`server/services/inventoryService.cjs` 등)로 분리하거나, `medicineInRoutes.cjs` 내부에 동일 로직을 복제해야 합니다.

---

### S-2. 약품/키트/수질 ViewModel — `toISOString()` UTC 날짜 사용 (KST 불일치)

> [!CAUTION]
> 유량(`useFlowViewModel`)만 `getTodayKST()`를 사용하고, 나머지 3개 모듈은 `new Date().toISOString().split('T')[0]`(UTC)을 사용합니다.

**현상**: 한국 시간 00:00~08:59에 앱을 사용하면 약품/키트/수질의 "오늘" 날짜가 **어제**(UTC 기준)로 인식되어, 유량 그리드와 날짜가 불일치함.

**영향을 받는 파일**:
| 파일 | 줄 | 현재 코드 |
|------|-----|-----------|
| [useMedicineViewModel.js](file:///e:/Wastewater%20Treatment%20Plant/src/features/medicine/useMedicineViewModel.js#L48) | 48 | `today.toISOString().split('T')[0]` |
| [useKitViewModel.js](file:///e:/Wastewater%20Treatment%20Plant/src/features/kit/useKitViewModel.js#L70) | 70 | `today.toISOString().split('T')[0]` |
| [useWaterQualityViewModel.js](file:///e:/Wastewater%20Treatment%20Plant/src/features/water/useWaterQualityViewModel.js#L148) | 148 | `today.toISOString().split('T')[0]` |

**올바른 코드** ([useFlowViewModel.js](file:///e:/Wastewater%20Treatment%20Plant/src/features/flow/useFlowViewModel.js#L142) 참조):
```javascript
import { getTodayKST } from '../../core/constants';
const todayStr = getTodayKST();
```

**수정 방법**: 3개 파일 모두 `getTodayKST()`를 import해서 사용하도록 변경.

---

### S-3. admin 로그인 시 세션 미저장 후 `switchActiveSite`에서 NPE 가능성

**현상**: [useAuthViewModel.js:294](file:///e:/Wastewater%20Treatment%20Plant/src/features/auth/useAuthViewModel.js#L294)에서 admin 사용자의 경우 `AuthModel.clearSession()`을 호출하여 localStorage에 세션을 저장하지 않음 → `setUser(userData)`로 상태는 유지됨. 그러나 admin이 `switchActiveSite`([useAuthViewModel.js:342-356](file:///e:/Wastewater%20Treatment%20Plant/src/features/auth/useAuthViewModel.js#L342-L356))를 호출하면 `AuthModel.saveSession(updated)`가 내부적으로 admin 세션을 무시(`localStorage.removeItem`)하므로 로직은 정상 동작함.

**결론**: admin은 세션 비저장이 의도된 동작이므로 **실질적 NPE는 발생하지 않지만**, `switchActiveSite` 내에서 `isFieldWorker` 분기 전에 `saveSession`이 먼저 호출되고 직후 `clearSession`이 호출되는 비효율이 존재함. 심각도를 중간으로 하향 조정 가능.

---

## 🟡 중간 (잠재적 문제) — 5건

### M-1. `useAttendanceViewModel.js` — 미사용 `DriveSyncService` import

**위치**: [useAttendanceViewModel.js:3](file:///e:/Wastewater%20Treatment%20Plant/src/features/attendance/useAttendanceViewModel.js#L3)

```javascript
import { DriveSyncService } from '../../services/DriveSyncService';
```

`DriveSyncService`를 import하지만 ViewModel 내 어디에서도 사용하지 않습니다. Tree-shaking으로 제거될 수 있지만, 번들 도구에 따라 불필요한 모듈 로드를 유발할 수 있습니다.

**수정**: 해당 import 라인 삭제.

---

### M-2. 프리로드 캐시가 현장(site) 전환 시 무효화되지 않음

**현상**: `recordPreloadService.js`의 캐시는 `user.id` 기준으로 프리로드되지만, **같은 사용자가 현장을 전환**하면 이전 현장의 캐시 데이터가 그대로 사용됩니다.

**위치**:
- [App.jsx:100](file:///e:/Wastewater%20Treatment%20Plant/src/App.jsx#L100): `preloadedUserId === user.id`만 비교
- [recordPreloadService.js](file:///e:/Wastewater%20Treatment%20Plant/src/features/records/recordPreloadService.js): 캐시 키에 `site_id` 미포함

**영향**: 현장 전환 후 유량/약품/수질/키트 그리드에 이전 현장 데이터가 표시됨 (새로고침 전까지).

**수정 방법**:
```diff
 // App.jsx
 -if (preloadedUserId === user.id) return undefined;
 +const preloadKey = `${user.id}::${user.site_id}`;
 +if (preloadedUserId === preloadKey) return undefined;
  // ...
 -setPreloadedUserId(user.id);
 +setPreloadedUserId(preloadKey);
```

또는 `switchActiveSite` 호출 후 `clearRecordGridHistoryCache()`를 실행하고 `preloadedUserId`를 리셋.

---

### M-3. 키트 자동저장 타이머 120ms — 의도적이지만 너무 짧을 수 있음

**위치**: [useKitViewModel.js:285](file:///e:/Wastewater%20Treatment%20Plant/src/features/kit/useKitViewModel.js#L285)

```javascript
}, 120);  // 120ms debounce
```

키트 그리드에서 셀 편집 시 120ms 후 자동저장이 트리거됩니다. 빠른 연속 입력 시 매 입력마다 서버 요청이 발생할 수 있습니다.

**권장**: 500~1000ms로 늘리거나, 사용자 의도에 맞는 적절한 값으로 조정.

---

### M-4. 서버측 `/api/flows/history` — 전체 flow_readings 조회 후 JavaScript로 날짜별 필터링

**위치**: [flowRoutes.cjs:88-114](file:///e:/Wastewater%20Treatment%20Plant/server/routes/flowRoutes.cjs#L88-L114)

```javascript
const allReadings = db.prepare('SELECT * FROM flow_readings ORDER BY date ASC, type ASC').all();
const history = dates.map(d => {
    const dayReadings = allReadings.filter(r => r.date === d.date);  // O(n*m) 필터링
    // ...
});
```

데이터가 누적될수록 전체 `flow_readings`를 메모리에 로드 후 `.filter()`로 날짜별 매칭하므로 성능이 저하됩니다. `medicine_logs`, `kit_logs` history 엔드포인트는 단순 `SELECT *`로 반환하고 프론트엔드에서 가공하는 방식을 사용하므로 상대적으로 양호합니다.

**권장**: `flow_readings`도 raw records를 반환하고 프론트엔드에서 가공하는 방식으로 통일하거나, SQL GROUP BY로 처리.

---

### M-5. `useMedicineViewModel` — `loadLogs`의 `useCallback` 미적용

**위치**: [useMedicineViewModel.js:44](file:///e:/Wastewater%20Treatment%20Plant/src/features/medicine/useMedicineViewModel.js#L44)

```javascript
const loadLogs = async (options = {}) => {  // 일반 함수로 선언
```

반면 `useFlowViewModel`과 `useKitViewModel`은 `useCallback`을 사용합니다:
```javascript
const loadReadings = useCallback(async (options = {}) => { ... }, [flowTypesResolved, showAlert]);
const loadLogs = useCallback(async (options = {}) => { ... }, []);
```

`useMedicineViewModel`의 `loadLogs`가 `useCallback`이 아니므로 매 렌더마다 새 함수 참조가 생성되어, 이를 의존성으로 쓰는 곳이 있다면 불필요한 리렌더가 발생합니다.

**수정**: `loadLogs`를 `useCallback`으로 감싸기.

---

## 🟢 낮음 (개선 권장) — 4건

### L-1. `DriveSyncService.js` — 전체가 stub(미구현) 상태

**위치**: [DriveSyncService.js](file:///e:/Wastewater%20Treatment%20Plant/src/services/DriveSyncService.js)

모든 메서드가 `void` + `return true/null`인 stub입니다. Google Drive 직접 동기화는 현재 BigQuery/Sheets 기반으로 전환되었으므로, 이 서비스 자체를 사용하는 곳이 없다면 삭제를 권장합니다.

현재 사용처: `useAttendanceViewModel.js`에서 import만 하고 실제 호출 없음 (M-1과 연관).

---

### L-2. 약품/키트 ViewModel — 로드 시 재고 자동 계산 주석 처리됨 (의도적)

**위치**:
- [useMedicineViewModel.js:130-133](file:///e:/Wastewater%20Treatment%20Plant/src/features/medicine/useMedicineViewModel.js#L130-L133)
- [useKitViewModel.js:148-151](file:///e:/Wastewater%20Treatment%20Plant/src/features/kit/useKitViewModel.js#L148-L151)

```javascript
// 재고 자동 계산은 이제 더 이상 로드 시 수행하지 않음 (DB 값 신뢰)
```

서버에서 `recalculateMedicineInventory`/`recalculateKitInventory`가 저장 시마다 호출되므로 이 주석 처리는 의도적이고 정상입니다. 단, **S-1 문제(medicineInRoutes에서 재계산 누락)**가 수정되기 전까지는 약품입고일지를 통해 저장된 데이터의 재고가 맞지 않을 수 있습니다.

---

### L-3. `AuthModel.js` — `ADMIN_ROLES` 이중 정의

**위치**:
- [AuthModel.js:4](file:///e:/Wastewater%20Treatment%20Plant/src/features/auth/AuthModel.js#L4): `const ADMIN_ROLES = ['admin', 'group_admin'];`
- [constants/index.js:78](file:///e:/Wastewater%20Treatment%20Plant/src/core/constants/index.js#L78): `export const ADMIN_ROLES = ['admin', 'group_admin'];`

`AuthModel.js` 내부에 별도로 `ADMIN_ROLES`를 정의하고 있어 향후 역할이 추가/변경될 때 한쪽만 수정하는 실수가 발생할 수 있습니다.

**권장**: `AuthModel.js`에서 `core/constants`의 `ADMIN_ROLES`를 import하여 사용.

---

### L-4. `certificate` 테이블 — BigQuery 동기화 매핑에 포함되어 있지만 `TABLE_MAPPINGS`에 없음

**위치**: [bigQuerySyncService.cjs](file:///e:/Wastewater%20Treatment%20Plant/server/services/bigQuerySyncService.cjs#L74-L158)

`TABLE_MAPPINGS` 객체에 `flow_readings`, `medicine_logs`, `qntech_water_quality`, `kit_logs`, `facility_logs`만 등록되어 있고, `attendance` 테이블은 별도의 [attendanceBigQueryService.cjs](file:///e:/Wastewater%20Treatment%20Plant/server/services/attendanceBigQueryService.cjs)에서 처리됩니다. 이는 의도적 구조로 보이며 정상입니다.

단, `certificate_cache` 등 로컬에서 캐싱하는 테이블은 BigQuery 동기화 대상이 아닌 것으로 확인됩니다.

---

## 정상 동작 확인 항목

다음 항목들은 코드 분석 결과 정상적으로 구현되어 있음을 확인했습니다:

### ✅ 로그인 → 로컬DB 캐싱 흐름
- `AuthModel.localLogin()` → Sheets 온라인 우선, 실패 시 로컬 DB 폴백
- `SyncService.startBackgroundSync()` → 로딩 완료 시 1회 실행
- `SyncService.initAutoSync()` → `online` 이벤트 리스너 등록

### ✅ 프리로드 시스템
- [recordPreloadService.js](file:///e:/Wastewater%20Treatment%20Plant/src/features/records/recordPreloadService.js): 로그인 후 설정 → 유량 → 약품 → 수질 → 키트 순차 프리로드
- [App.jsx:93-119](file:///e:/Wastewater%20Treatment%20Plant/src/App.jsx#L93-L119): `user.id` 기준 1회만 실행, 진행률 UI 표시
- 각 Model의 `historyCache` 패턴 (FlowModel, MedicineModel, WaterQualityModel, KitModel) 정상 동작

### ✅ 유량관리 (Flow)
- 검침값 입력 → `recalculateFromIndex()` → 연쇄 차이량 계산
- `submitBatch()` → `FlowModel.bulkSave()` → 서버에서 `recalculateFlowTypeCascade()`
- `is_synced = 0` 설정 → BigQuery 감시 미들웨어가 POST 응답 후 `triggerBigQuerySync()` 호출

### ✅ 수질분석 (Water)
- `handleImportFromQntech()` → 서버에서 QnTECH API 호출 → 로컬 DB 저장 → 프론트엔드에서 `persistImportedRows()` → 서버 `bulkSave`
- 수동 입력 → `updateReading()` → `pendingChanges` → `submitBatch()` → `WaterQualityModel.bulkSave()`
- `measurement_group` 기반 다회차 분석 지원 정상

### ✅ 출결 BigQuery 동기화
- 로그인 시 `recordAttendance()` → 로컬 SQLite `attendance` 테이블에 INSERT
- 로그아웃/자동퇴근 시 `recordLogout()` → `syncAttendanceBQ()` → 미동기화 로그를 BigQuery 전송
- `is_synced` 플래그 기반 중복 방지 정상
- 서버 시작 시 `is_synced = 2`(진행 중) 상태 → `is_synced = 0`으로 롤백 처리 정상

### ✅ 약품관리 (Medicine) — 그리드 직접 입력
- `updateAmount()` → 재고 연쇄 재계산 (`calculateInventory()`)
- `submitBatch()` → `MedicineModel.bulkSave()` → 서버 `recalculateMedicineInventory()` 정상 호출
- 입고 모달 → `savePurchase()` → `MedicineModel.savePurchase()` → 서버 재계산 정상

### ✅ 키트관리 (Kit) — 그리드 직접 입력
- `updateAmount()` → 재고 연쇄 재계산 (`calculateInventory()`)
- `submitBatch()` → `KitModel.bulkSave()` → 서버 `recalculateKitInventory()` 정상 호출
- `syncAnalysisKits()` → 수질분석 건수로 키트 사용량 역산 정상

### ✅ BigQuery 전체 동기화
- `bigQuerySyncService.cjs` → `syncAll()` → 5개 테이블 순차 동기화
- NDJSON 파일 → BigQuery Load Job → 성공 시 `is_synced = 1`, 실패 시 롤백
- `bigQueryTriggerService.cjs` → POST/PUT/DELETE 성공 응답 후 비동기 트리거

### ✅ API Client 재연결 메커니즘
- `serverConfig.js` → 포트 18731~18734 자동 탐색
- `apiClient.js` → 연결 실패 시 `rediscoverServer()` → 1회 재시도

---

## 수정 우선순위

| 순서 | ID | 작업 | 예상 시간 |
|------|-----|------|-----------|
| 1 | **S-1** | medicineInRoutes.cjs 재고 재계산 추가 | 30분 |
| 2 | **S-2** | 3개 ViewModel의 `toISOString()` → `getTodayKST()` 변경 | 15분 |
| 3 | **M-2** | 현장 전환 시 캐시 무효화 로직 추가 | 20분 |
| 4 | **M-1** | 미사용 DriveSyncService import 삭제 | 5분 |
| 5 | **M-5** | useMedicineViewModel loadLogs → useCallback | 10분 |
| 6 | **L-3** | AuthModel.js ADMIN_ROLES → 공통 상수 import | 5분 |

> [!NOTE]
> S-3은 현재 로직상 실질적 버그가 아니므로 우선순위에서 제외했습니다.
> M-3(키트 자동저장 타이머)과 M-4(flow history 쿼리 최적화)는 현장 테스트 결과에 따라 판단하세요.
