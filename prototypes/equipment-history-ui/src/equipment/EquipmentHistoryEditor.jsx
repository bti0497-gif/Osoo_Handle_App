// 장비 이력(점검/고장/수리) 등록·수정 모달. 상태와 검증은 ViewModel이 담당한다.
import React from 'react';
import { EQUIPMENT_HISTORY_TYPES } from './equipmentPreviewData';

const HistoryField = ({ label, required, children, wide }) => (
  <label className={wide ? 'wide' : ''}>
    <span>{label}{required ? <b> *</b> : null}</span>
    {children}
  </label>
);

export default function EquipmentHistoryEditor({
  draft, equipmentName, saving, onChangeField, onClose, onSave, onDelete,
}) {
  if (!draft) return null;
  return (
    <div className="equipment-editor-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="equipment-editor history-editor"
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? '장비 이력 수정' : '장비 이력 추가'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{draft.id ? '장비 이력 수정' : '장비 이력 추가'}</h2>
            <p>{equipmentName || '선택된 장비'} · 발생일 기준으로 이력카드에 누적됩니다.</p>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <div className="equipment-editor-body">
          <div className="equipment-editor-grid history-grid">
            <HistoryField label="발생일" required>
              <input
                type="date"
                autoFocus
                value={draft.date}
                onChange={(event) => onChangeField('date', event.target.value)}
              />
            </HistoryField>
            <HistoryField label="완료일">
              <input
                type="date"
                value={draft.completedAt}
                onChange={(event) => onChangeField('completedAt', event.target.value)}
              />
            </HistoryField>
            <HistoryField label="구분" required>
              <select value={draft.type} onChange={(event) => onChangeField('type', event.target.value)}>
                {EQUIPMENT_HISTORY_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </HistoryField>
            <HistoryField label="비용 (원)">
              <input
                type="number"
                min="0"
                step="100"
                value={draft.price}
                onChange={(event) => onChangeField('price', event.target.value)}
                placeholder="예: 320000"
              />
            </HistoryField>
            <HistoryField label="수리·공사내용" required wide>
              <textarea
                className="equipment-history-content"
                rows={4}
                value={draft.content}
                onChange={(event) => onChangeField('content', event.target.value)}
                placeholder="예: 베어링 교체 및 진동 측정 후 재가동"
              />
            </HistoryField>
            <HistoryField label="업체">
              <input
                value={draft.company}
                onChange={(event) => onChangeField('company', event.target.value)}
                placeholder="예: (주)대영기전"
              />
            </HistoryField>
            <HistoryField label="연락처">
              <input
                value={draft.contact}
                onChange={(event) => onChangeField('contact', event.target.value)}
                placeholder="예: 010-0000-0000"
              />
            </HistoryField>
          </div>
          <label className="equipment-editor-photo-bar">
            <span className="material-icons">add_photo_alternate</span>
            <b>{draft.photoName || '현장 사진 선택'}</b>
            <small>작업 전후 사진을 등록하세요.</small>
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
            <button type="button" className="primary" onClick={onSave} disabled={saving}>
              {saving ? '저장 중...' : (draft.id ? '수정 적용' : '이력 추가')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
