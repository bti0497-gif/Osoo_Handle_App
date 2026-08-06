import React, { useMemo, useState } from 'react';
import { EQUIPMENT_PREVIEW_ITEMS } from './equipmentPreviewData';
import './equipment.css';

export default function EquipmentLinkSelector({ value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = useMemo(
    () => EQUIPMENT_PREVIEW_ITEMS.filter((item) => value.includes(item.id)),
    [value],
  );
  const candidates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return EQUIPMENT_PREVIEW_ITEMS;
    return EQUIPMENT_PREVIEW_ITEMS.filter((item) => [item.managementNo, item.name, item.location, item.category3]
      .some((field) => String(field || '').toLowerCase().includes(keyword)));
  }, [query]);

  const toggle = (id) => {
    onChange?.(value.includes(id) ? value.filter((itemId) => itemId !== id) : [...value, id]);
  };

  return (
    <section className="equipment-link-selector">
      <div className="equipment-link-heading">
        <div>
          <strong>관련 장비</strong>
          <span>장비와 관련 없는 일반 업무는 선택하지 않아도 됩니다.</span>
        </div>
        <button type="button" onClick={() => setOpen(true)}>
          <span className="material-icons">link</span>
          장비 연결
        </button>
      </div>
      {selected.length ? (
        <div className="equipment-link-chips">
          {selected.map((item) => (
            <span key={item.id} className="equipment-link-chip">
              <b>{item.managementNo}</b> {item.name}
              <button type="button" onClick={() => toggle(item.id)} aria-label={`${item.name} 연결 해제`}>×</button>
            </span>
          ))}
        </div>
      ) : <p className="equipment-link-empty">연결된 장비 없음 · 일반 업무로 저장됩니다.</p>}

      {open ? (
        <div className="equipment-picker-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div className="equipment-picker" role="dialog" aria-modal="true" aria-label="관련 장비 선택" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>관련 장비 선택</h3>
                <p>이 업무와 관련된 장비만 선택하세요. 여러 대를 연결할 수 있습니다.</p>
              </div>
              <button type="button" className="equipment-icon-button" onClick={() => setOpen(false)}>×</button>
            </header>
            <div className="equipment-picker-search">
              <span className="material-icons">search</span>
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="관리번호, 설비명, 위치 검색" />
            </div>
            <div className="equipment-picker-list">
              {candidates.map((item) => {
                const checked = value.includes(item.id);
                return (
                  <button key={item.id} type="button" className={checked ? 'selected' : ''} onClick={() => toggle(item.id)}>
                    <span className="equipment-picker-check">{checked ? '✓' : ''}</span>
                    <span className="equipment-picker-number">{item.managementNo}</span>
                    <span className="equipment-picker-copy"><b>{item.name}</b><small>{item.location} · {item.category3}</small></span>
                  </button>
                );
              })}
              {!candidates.length ? <p className="equipment-picker-none">검색 결과가 없습니다.</p> : null}
            </div>
            <footer>
              <span>{value.length}대 선택</span>
              <button type="button" onClick={() => setOpen(false)}>선택 완료</button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
