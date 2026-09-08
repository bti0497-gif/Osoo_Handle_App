// 장비(설비 마스터) 등록·수정 모달. 상태와 검증은 ViewModel이 담당한다.
import React from 'react';
import {
  EQUIPMENT_CATEGORY_OPTIONS,
  EQUIPMENT_PROCESS_ORDER,
  EQUIPMENT_STATUS_OPTIONS,
  EQUIPMENT_TYPE_ORDER,
} from './equipmentPreviewData';

const Field = ({ label, required, children, wide }) => (
  <label className={wide ? 'wide' : ''}>
    <span>{label}{required ? <b> *</b> : null}</span>
    {children}
  </label>
);

export default function EquipmentEditorModal({
  draft, saving, onChangeField, onClose, onSave, onDelete,
}) {
  if (!draft) return null;
  return (
    <div className="equipment-editor-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="equipment-editor"
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? '장비 수정' : '장비 추가'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{draft.id ? '장비 정보 수정' : '새 장비 추가'}</h2>
            <p>장비이력카드의 기준이 되는 설비 기본정보를 입력합니다.</p>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <div className="equipment-editor-body">
          <div className="equipment-editor-grid">
            <Field label="관리번호 (자동 부여)" required>
              <input
                autoFocus
                value={draft.managementNo}
                onChange={(event) => onChangeField('managementNo', event.target.value)}
                placeholder="규칙에 따라 자동 부여 — 필요하면 직접 수정하세요"
              />
            </Field>
            <Field label="설비명" required>
              <input
                value={draft.name}
                onChange={(event) => onChangeField('name', event.target.value)}
                placeholder="예: 하수이송펌프 토출밸브"
              />
            </Field>
            <Field label="구분 1 (공정)">
              <select value={draft.category1} onChange={(event) => onChangeField('category1', event.target.value)}>
                {EQUIPMENT_PROCESS_ORDER.map((process) => <option key={process}>{process}</option>)}
              </select>
            </Field>
            <Field label="구분 2 (종류)">
              <select value={draft.category2} onChange={(event) => onChangeField('category2', event.target.value)}>
                {EQUIPMENT_TYPE_ORDER.map((type) => <option key={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="구분 3">
              <select value={draft.category3} onChange={(event) => onChangeField('category3', event.target.value)}>
                {EQUIPMENT_CATEGORY_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="형식">
              <input value={draft.model} onChange={(event) => onChangeField('model', event.target.value)} />
            </Field>
            <Field label="사양">
              <input value={draft.specification} onChange={(event) => onChangeField('specification', event.target.value)} />
            </Field>
            <Field label="동력">
              <input value={draft.power} onChange={(event) => onChangeField('power', event.target.value)} placeholder="예: 0.75 kW" />
            </Field>
            <Field label="설치일자">
              <input type="month" value={draft.installedAt} onChange={(event) => onChangeField('installedAt', event.target.value)} />
            </Field>
            <Field label="납품회사">
              <input value={draft.vendor} onChange={(event) => onChangeField('vendor', event.target.value)} />
            </Field>
            <Field label="설치 위치">
              <input value={draft.location} onChange={(event) => onChangeField('location', event.target.value)} />
            </Field>
            <Field label="부속설비" wide>
              <input value={draft.accessory} onChange={(event) => onChangeField('accessory', event.target.value)} />
            </Field>
            <Field label="비고" wide>
              <input
                value={draft.notes}
                onChange={(event) => onChangeField('notes', event.target.value)}
                placeholder="예: 기본 2대 · 추가 시 C, D, E..."
              />
            </Field>
            <Field label="상태">
              <select value={draft.status} onChange={(event) => onChangeField('status', event.target.value)}>
                {EQUIPMENT_STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </Field>
          </div>
          <label className="equipment-editor-photo-bar">
            <span className="material-icons">add_photo_alternate</span>
            <b>{draft.photoName || '대표사진 선택'}</b>
            <small>장비 전체 모습이나 명판 사진을 등록하세요.</small>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => onChangeField('photoName', event.target.files?.[0]?.name || '')}
            />
          </label>
        </div>
        <footer>
          <div>
            {draft.id ? (
              <button type="button" className="danger" onClick={onDelete} disabled={saving}>삭제</button>
            ) : null}
            <button type="button" onClick={onClose} disabled={saving}>취소</button>
            <button
              type="button"
              className="primary"
              onClick={onSave}
              disabled={saving || !String(draft.managementNo || '').trim() || !String(draft.name || '').trim()}
            >
              {saving ? '저장 중...' : (draft.id ? '수정 적용' : '장비 추가')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
