/**
 * AdvancedDataGrid 편집 동작을 화면별로 맞추기 위한 공통 props 프리셋.
 *
 * - 읽기 전용(약품/유량/수질/키트 등): 셀 편집은 끄고, renderCell + onCellDoubleClick 등으로만 상호작용.
 * - 잠금 행 편집(현장관리 등): 한 행만 편집 가능, 다른 행 클릭 차단, 블러 커밋 비활성화(취소/저장 버튼 흐름).
 *
 * 새 화면에서 그리드를 쓸 때:
 * 1) 목록만 보여주면 `...ADVANCED_DATAGRID_READ_ONLY_PROPS` 를 펼치고 나머지 props 작성.
 * 2) “행 추가/수정 → 한 줄만 폼처럼 편집”이면 `getLockedRowEditGridProps(active, rowKey)` 결과를 펼치고
 *    `isCellEditable`, `onCellChange`, `renderCellEditor`(텍스트는 null로 기본 input) 를 반드시 연결.
 */

/** 그리드 내장 셀 편집 비활성화 — 커스텀 renderCell·더블클릭으로만 입력하는 화면용 */
export const ADVANCED_DATAGRID_READ_ONLY_PROPS = {
    enableEditing: false,
    editableRowKey: null,
    editModeLockedRowKey: null,
    blockInteractionOutsideRow: false,
    startEditOnSingleClick: false,
    startEditOnDoubleClick: false,
    startEditOnEnter: false,
    startEditOnTyping: false,
    commitOnBlur: true,
    selectTextOnEditStart: false,
};

/**
 * 한 행만 잠금 편집 모드일 때 AdvancedDataGrid에 펼칠 props.
 * @param {boolean} active 편집 모드가 켜진 경우 true
 * @param {string|null|undefined} editRowKey keyField와 일치하는 편집 중인 행의 키(신규 행이면 전용 상수)
 * @returns {Record<string, unknown>}
 */
export function getLockedRowEditGridProps(active, editRowKey) {
    const locked = active && editRowKey != null && String(editRowKey).length > 0;
    if (locked) {
        return {
            enableEditing: true,
            editableRowKey: editRowKey,
            editModeLockedRowKey: editRowKey,
            blockInteractionOutsideRow: true,
            startEditOnSingleClick: true,
            startEditOnDoubleClick: true,
            startEditOnEnter: true,
            startEditOnTyping: true,
            commitOnBlur: false,
            selectTextOnEditStart: true,
        };
    }
    return { ...ADVANCED_DATAGRID_READ_ONLY_PROPS };
}
