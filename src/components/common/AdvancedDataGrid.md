# AdvancedDataGrid v2 — API Reference

> Excel-Grade React DataGrid 컴포넌트 | Swiss Clean Design System
> 
> 다른 React 프로젝트에서 자유롭게 가져다 쓸 수 있는 독립 컴포넌트입니다.

---

## 📦 Import

```jsx
// 방법 1: 직접 import
import AdvancedDataGrid from './components/common/AdvancedDataGrid';

// 방법 2: index.js 통해 import
import { AdvancedDataGrid } from './components/common';

// 편집 모드 프리셋 (이 저장소 전용 — advancedDataGridPresets.js)
import {
  ADVANCED_DATAGRID_READ_ONLY_PROPS,
  getLockedRowEditGridProps,
} from './components/common/advancedDataGridPresets';
```

### 의존성
- `react` (v17+)
- React Hooks: `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`
- **외부 라이브러리 없음** — 순수 React 컴포넌트

---

## 🚀 Quick Start

```jsx
import AdvancedDataGrid from './AdvancedDataGrid';

const columns = [
  {
    id: 'group1',
    label: '분석 항목',
    subCols: [
      { id: 'col_a', label: '측정A', width: 80 },
      { id: 'col_b', label: '측정B', width: 80 },
    ],
    borderRight: '2px solid #B0B0B0'
  },
  {
    id: 'group2',
    label: '결과',
    subCols: [
      { id: 'col_c', label: '값C', width: 100 },
    ]
  }
];

const data = [
  { id: 1, col_a: 3.5, col_b: 4.2, col_c: 100 },
  { id: 2, col_a: 2.1, col_b: 3.8, col_c: 80 },
];

function App() {
  return (
    <AdvancedDataGrid
      title="수질 분석 데이터"
      columns={columns}
      data={data}
      keyField="id"
      sortable
      resizableColumns
      enableClipboard
      showStatusBar
      cellAlign="center"
      onCellChange={(row, colId, value) => console.log('변경:', colId, value)}
    />
  );
}
```

---

## 🧭 이 프로젝트에서 권장하는 사용 패턴 (프리셋)

같은 `AdvancedDataGrid`라도 **내장 셀 편집**을 쓰는지, **커스텀 셀(`renderCell`)만** 쓰는지에 따라 넘겨야 할 props가 다릅니다. 아래 프리셋으로 통일하면 화면마다 편집 동작이 어긋나지 않습니다.

| 상황 | 사용법 | 예시 화면 |
|------|--------|-----------|
| **내장 편집 끄기** — 숫자/입력은 `renderCell`·모달·더블클릭으로만 처리 | `<AdvancedDataGrid {...ADVANCED_DATAGRID_READ_ONLY_PROPS} ... />` | 약품·유량·수질·키트 관리 |
| **한 행만 잠금 편집** — 행 추가/수정 후 그 행만 클릭·입력, 나머지 행은 막음 | `getLockedRowEditGridProps(active, editRowKey)` 결과를 spread 한 뒤 `isCellEditable`, `onCellChange`, `renderCellEditor` 필수 연결 | 회원/현장 → 현장관리 |

**잠금 행 편집 시 주의**

- `renderCellEditor`에서 **텍스트 열은 `return null`** 로 두어 기본 `<input>`을 쓰세요. `null`이 아닌 빈 Fragment만 반환하면 입력창이 안 뜹니다.
- 드롭다운 등 커스텀 에디터는 `options.onChange`로 `editingCell.tempValue`와 동기화하세요.
- `editableRowKey` / `editModeLockedRowKey`는 같은 값(편집 중인 행의 `keyField` 값)으로 맞춥니다.

```jsx
import { ADVANCED_DATAGRID_READ_ONLY_PROPS } from './advancedDataGridPresets';

<AdvancedDataGrid
  {...ADVANCED_DATAGRID_READ_ONLY_PROPS}
  columns={gridCols}
  data={history}
  renderCell={renderCell}
  onCellDoubleClick={handleCellDoubleClick}
/>
```

```jsx
import { getLockedRowEditGridProps } from './advancedDataGridPresets';

const editProps = useMemo(
  () => getLockedRowEditGridProps(isEditing, editingRowKey),
  [isEditing, editingRowKey]
);

<AdvancedDataGrid
  {...editProps}
  isCellEditable={(row, col) => /* 편집 행·열만 true */}
  onCellChange={(row, colId, value) => /* 상위 state 반영 */}
  renderCellEditor={...}
/>
```

---

## 📋 Props API

### Meta & Data

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `title` | `string` | `''` | 그리드 상단 제목 |
| `description` | `string` | `''` | 제목 옆 부가 설명 텍스트 |
| `columns` | `Column[]` | `[]` | 칼럼 스키마 배열 (아래 Column 스키마 참고) |
| `data` | `object[]` | `[]` | 행 데이터 배열. 각 객체의 키가 칼럼 id와 매핑 |
| `keyField` | `string` | `'id'` | 각 행의 고유 식별 필드명 |

### Dimensions (크기)

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `width` | `string \| number` | `'100%'` | 그리드 전체 너비 |
| `height` | `number` | `600` | 그리드 본문 높이 (px) |
| `rowHeight` | `number` | `36` | 데이터 행 높이 (px) |
| `headerRowHeight` | `number` | `40` | 헤더 행 높이 (px) |
| `defaultColumnWidth` | `number` | `100` | 칼럼 기본 너비 (px) |
| `rowHeaderWidth` | `number` | `50` | 행 번호 헤더 너비 (px) |
| `fontSize` | `number` | `13` | 셀 폰트 크기 (px) |
| `headerFontSize` | `number` | `13` | 헤더 폰트 크기 (px) |

### Visibility (표시)

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `showHeader` | `boolean` | `true` | 상단 제목/툴바 표시 |
| `showRowHeader` | `boolean` | `true` | 행 번호(#) 헤더 표시 |
| `showHorizontalLines` | `boolean` | `true` | 가로 그리드선 표시 |
| `showVerticalLines` | `boolean` | `true` | 세로 그리드선 표시 |
| `showBottomBar` | `boolean` | `true` | 하단 액션바 표시 |
| `showStatusBar` | `boolean` | `true` | 상태바 (SUM/AVG/COUNT) 표시 |

### Styling & Colors (스타일)

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `headerBgColor` | `string` | `'#FAFAFA'` | 헤더 배경색 |
| `headerTextColor` | `string` | `'#0D0D0D'` | 헤더 글자색 |
| `activeHeaderBgColor` | `string` | `'#E8E8E8'` | 선택된 헤더 배경색 |
| `activeHeaderTextColor` | `string` | `'#0D0D0D'` | 선택된 헤더 글자색 |
| `gridLineColor` | `string` | `'#E8E8E8'` | 그리드선 색상 |
| `gridLineWidth` | `number` | `1` | 그리드선 굵기 (px) |
| `rowBgColor` | `string` | `'#FFFFFF'` | 짝수 행 배경색 |
| `altRowBgColor` | `string` | `'#FAFAFA'` | 홀수 행 배경색 (줄무늬) |
| `selectedCellBorderColor` | `string` | `'#3b82f6'` | 선택 셀 테두리 색 |
| `selectedCellBorderWidth` | `number` | `1` | 선택 셀 테두리 굵기 (px) |
| `hoverRowBgColor` | `string` | `'#e2e8f0'` | 마우스 호버 행 배경색 |
| `readOnlyCellBgColor` | `string` | `'#FAFAFA'` | 읽기전용 셀 배경색 |
| `columnHighlightBgColor` | `string` | `'rgba(59, 130, 246, 0.12)'` | 선택 축 하이라이트 배경색 |
| `cellAlign` | `string` | `'left'` | 셀 텍스트 정렬: `'left'` \| `'center'` \| `'right'` |

### Selection & Editing (선택/편집)

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `selectionMode` | `string` | `'cell'` | 선택 모드: `'cell'` \| `'row'` |
| `enableEditing` | `boolean` | `true` | 셀 편집 활성화 |
| `editableRowKey` | `any` | `null` | 특정 행만 편집 허용 (keyField 값과 일치하는 행만) |
| `editModeLockedRowKey` | `any` | `null` | 설정 시 해당 행 **외** 셀 클릭·행 헤더 등 상호작용 차단(잠금 행 편집) |
| `blockInteractionOutsideRow` | `boolean` | `false` | `true`이면 잠금 행이 아닌 영역 포인터 차단 |
| `isCellEditable` | `function` | `undefined` | `(row, col) => boolean` — 셀별 편집 가능 여부 |
| `tabNavigation` | `boolean` | `true` | Tab/Shift+Tab 네비게이션 |
| `enableClipboard` | `boolean` | `true` | Ctrl+C/V 클립보드 기능 |
| `rangeSelection` | `boolean` | `false` | Shift+Click 범위 선택 |
| `highlightSelectionRow` | `boolean` | `true` | 활성 셀 기준 같은 행 하이라이트 여부 |
| `highlightSelectionColumn` | `boolean` | `true` | 활성 셀 기준 같은 열 하이라이트 여부 |
| `startEditOnDoubleClick` | `boolean` | `true` | 더블클릭 시 편집 시작 여부 |
| `startEditOnSingleClick` | `boolean` | `false` | 싱글 클릭만으로 편집 시작(잠금 행 편집과 함께 켜는 경우 많음) |
| `startEditOnEnter` | `boolean` | `true` | Enter 입력 시 편집 시작 여부 |
| `startEditOnTyping` | `boolean` | `true` | 문자 타이핑으로 편집 시작 여부 |
| `typingEditMode` | `string` | `'overwrite'` | 타이핑 편집 시작 모드: `'overwrite'` \| `'append'` |
| `commitOnBlur` | `boolean` | `true` | 외부 클릭 시 편집값 확정 여부 |
| `enterKeyBehavior` | `string` | `'moveDown'` | 편집 중 Enter 후 동작: `'moveDown'` \| `'stay'` |
| `selectTextOnEditStart` | `boolean` | `false` | 편집 시작 시 기존 텍스트 전체 선택 여부 |

### Column Features (칼럼 기능)

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `resizableColumns` | `boolean` | `true` | 칼럼 드래그 크기 조절 |
| `sortable` | `boolean` | `false` | 헤더 클릭 정렬 (asc/desc/none) |
| `frozenColumns` | `number` | `0` | 왼쪽 고정 칼럼 수 |
| `contextMenu` | `boolean` | `true` | 우클릭 컨텍스트 메뉴 |

### Event Handlers (이벤트)

| Prop | Type | 설명 |
|------|------|------|
| `onCellChange` | `(row, colId, newValue) => void` | 셀 값 변경 시 |
| `onRowSelect` | `(row) => void` | 행 선택 시 |
| `onColumnSelect` | `(colId) => void` | 칼럼 선택 시 |
| `onSort` | `({ colId, direction }) => void` | 정렬 변경 시 |
| `onCellDoubleClick` | `(row, col) => void` | 셀 더블클릭 시(내장 편집과 별개로 호출 가능) |
| `onSave` | `() => void` | 저장 버튼 클릭 시 |
| `onRefresh` | `() => void` | 새로고침 버튼 클릭 시 |

### Actions (액션)

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `saveLabel` | `string` | `'Save'` | 저장 버튼 텍스트 |
| `hasPending` | `boolean` | `false` | 미저장 변경 있음 표시 |
| `loading` | `boolean` | `false` | 로딩 상태 표시 |
| `extraActions` | `ReactNode` | `null` | 하단바에 추가할 커스텀 버튼 |

### Overrides (커스텀 렌더러)

| Prop | Type | 설명 |
|------|------|------|
| `renderRowHeader` | `(index, row) => ReactNode` | 행 헤더 커스텀 렌더링 |
| `renderCell` | `(row, col, value) => ReactNode` | 셀 커스텀 렌더링 |
| `renderCellDisplay` | `(row, col, value, isSelected) => ReactNode` | 표시 전용 셀 렌더러 |
| `renderCellEditor` | `(row, col, value, editorApi) => ReactNode` | 편집 중 셀 에디터. **텍스트는 `null` 반환 시 기본 input** |

### Navigation

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `scrollToKey` | `any` | `null` | `keyField`가 이 값인 행으로 스크롤(예: 오늘 날짜 행) |

### Theme (테마)

| Prop | Type | Default | 설명 |
|------|------|---------|------|
| `theme` | `string` | `'swiss'` | 테마 프리셋: `'swiss'` \| `'excel'` \| `'notion'` |

---

## 📐 Column Schema

```typescript
interface Column {
  id: string;            // 칼럼 고유 ID (data 객체의 키와 매핑)
  label: string;         // 표시 이름
  width?: number;        // 칼럼 너비 (px), 없으면 defaultColumnWidth 사용
  align?: string;        // 개별 칼럼 정렬: 'left' | 'center' | 'right'
  editable?: boolean;    // 편집 가능 여부
  headerBgColor?: string;     // 헤더 배경색 개별 지정
  headerTextColor?: string;   // 헤더 글자색 개별 지정
  borderRight?: string;  // 오른쪽 그룹 구분선 (예: '2px solid #B0B0B0')
  borderLeft?: string;   // 왼쪽 그룹 구분선
  subCols?: Column[];    // 2단 헤더용 하위 칼럼 배열
}
```

### 2단 헤더 예시

```jsx
const columns = [
  {
    id: 'nh3_n',
    label: 'NH3-N',
    borderRight: '2px solid #B0B0B0',  // 그룹 간 굵은 구분선
    subCols: [
      { id: 'nh3_n_loc1', label: '유량', width: 60 },
      { id: 'nh3_n_loc2', label: '무산', width: 60 },
      { id: 'nh3_n_loc3', label: '포기', width: 60 },
    ]
  },
  {
    id: 'no3_n',
    label: 'NO3-N',
    subCols: [
      { id: 'no3_n_loc1', label: '유량', width: 60, align: 'right' },
      { id: 'no3_n_loc2', label: '무산', width: 60, align: 'right' },
    ]
  }
];
```

---

## ⌨️ Keyboard Shortcuts

| 키 | 동작 |
|----|------|
| `Arrow Keys` | 셀 이동 (상/하/좌/우) |
| `Tab` | 다음 셀로 이동 |
| `Shift + Tab` | 이전 셀로 이동 |
| `Enter` | 편집 확정 후 아래 셀로 이동 |
| `Escape` | 편집 취소 |
| `Delete` | 선택 셀 내용 삭제 |
| `Ctrl + C` | 셀 값 복사 |
| `Ctrl + V` | 셀에 붙여넣기 |
| `문자 입력` | 선택 셀에서 바로 편집 시작 (기존 값 덮어쓰기) |

---

## 🖱️ Mouse Interactions

| 동작 | 설명 |
|------|------|
| **셀 클릭** | 셀 선택 (파란 포커스 링) |
| **더블클릭** | `startEditOnDoubleClick`가 켜져 있으면 기존 값을 유지한 채 편집 시작 |
| **문자 타이핑** | `startEditOnTyping`이 켜져 있으면 편집 시작, `typingEditMode`에 따라 덮어쓰기/이어쓰기 |

---

## 🔧 Customization Strategy

- 공통 그리드를 엑셀형 기본 UX로 사용하려면 `enableEditing`, `startEditOnTyping`, `startEditOnDoubleClick`, `highlightSelectionRow`, `highlightSelectionColumn` 기본값을 그대로 사용합니다.
- 실제 업무 화면처럼 편집 흐름을 직접 제어하려면 `enableEditing={false}`와 `renderCell` 조합으로 공통 편집 엔진을 끄고, 필요한 셀만 별도 입력 컴포넌트로 렌더링하면 됩니다.
- 표시와 편집을 분리하고 싶다면 `renderCellDisplay`와 `renderCellEditor`를 사용합니다. 기존 `renderCell`이 있으면 하위 호환을 위해 `renderCell`이 우선 적용됩니다.
| **셀 더블클릭** | 편집 모드 진입 |
| **헤더 클릭** | 해당 칼럼 전체 선택 + 정렬 토글 |
| **그룹 헤더 클릭** | 하위 칼럼 전체 선택 |
| **행 번호 클릭** | 해당 행 전체 선택 |
| **우클릭** | 컨텍스트 메뉴 (복사/붙여/지우기/정렬) |
| **헤더 가장자리 드래그** | 칼럼 너비 조절 |

---

## 📊 Status Bar

셀/칼럼/행 선택 시 하단에 실시간 계산값 표시:

| 항목 | 설명 |
|------|------|
| **SUM** | 선택 범위의 합계 |
| **AVG** | 선택 범위의 평균 |
| **COUNT** | 선택 범위의 유효 숫자 개수 |

---

## 🎨 Theme Presets

### Swiss Clean (기본)
```jsx
<AdvancedDataGrid theme="swiss" />
```
- Typography: Space Grotesk (헤더) + Inter (본문)
- 색상: `#0D0D0D`, `#FAFAFA`, `#E8E8E8`
- 액센트: `#E42313` (빨강)
- 라디오스: 0px (날카로운 모서리)

---

## 💡 Usage Examples

### 읽기전용 그리드
```jsx
<AdvancedDataGrid
  columns={columns}
  data={data}
  enableEditing={false}
  cellAlign="right"
/>
```

### 특정 행만 편집 가능
```jsx
<AdvancedDataGrid
  columns={columns}
  data={data}
  editableRowKey={currentDate}
  keyField="date"
/>
```

### 특정 셀만 편집 가능
```jsx
<AdvancedDataGrid
  columns={columns}
  data={data}
  isCellEditable={(row, col) => col.id !== 'readonly_col'}
/>
```

### 커스텀 셀 렌더링
```jsx
<AdvancedDataGrid
  columns={columns}
  data={data}
  renderCell={(row, col, value) => {
    if (value > 100) return <span style={{ color: 'red' }}>{value}</span>;
    return value;
  }}
/>
```

### 이벤트 핸들링
```jsx
<AdvancedDataGrid
  columns={columns}
  data={data}
  onCellChange={(row, colId, newValue) => {
    updateData(row.id, colId, newValue);
  }}
  onSort={({ colId, direction }) => {
    fetchSortedData(colId, direction);
  }}
  onColumnSelect={(colId) => {
    highlightColumn(colId);
  }}
/>
```

### 전체 스타일 커스터마이징
```jsx
<AdvancedDataGrid
  columns={columns}
  data={data}
  headerBgColor="#1a1a2e"
  headerTextColor="#eaeaea"
  activeHeaderBgColor="#16213e"
  gridLineColor="#2d2d4a"
  selectedCellBorderColor="#00d2ff"
  rowBgColor="#0f3460"
  altRowBgColor="#16213e"
  hoverRowBgColor="rgba(0,210,255,0.05)"
  cellAlign="center"
  fontSize={14}
  rowHeight={40}
/>
```

---

## 📁 File Structure

```
src/components/common/
├── AdvancedDataGrid.jsx          # 메인 컴포넌트 (순수 React)
├── AdvancedDataGrid.md           # 이 문서 (API + 사용 가이드)
├── advancedDataGridPresets.js    # 읽기 전용 / 잠금 행 편집 프리셋 (이 앱 공통)
└── index.js                      # AdvancedDataGrid + 프리셋 export
```

---

## 📌 Notes

- **순수 React**: 외부 CSS, 라이브러리 불필요. `react`만 있으면 동작
- **가상화**: 대용량 데이터 대응 (수천 행 렌더링 최적화)
- **SSR 호환**: Next.js 등에서 사용 가능
- **타입 안전**: 모든 prop에 기본값 설정

---

*AdvancedDataGrid v2.0 — Built with Swiss Clean Design System*
