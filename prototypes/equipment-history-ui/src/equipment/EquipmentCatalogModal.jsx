// 장비 추가 카탈로그 모달: 체크 = 목록 등록, 해제 = 목록 제거(양방향 동기화).
// 개수형(펌프·교반기·브로아·막분리)의 스테퍼는 '원하는 대수'로, 늘리면 다음 호기가
// 추가되고 줄이면 높은 호기부터 제거된다. 상태와 생성/제거 규칙은 ViewModel/Model이 담당한다.
import React from 'react';
import { EQUIPMENT_PROCESS_ORDER, EQUIPMENT_TYPE_ORDER } from './equipmentPreviewData';

export default function EquipmentCatalogModal({
  groups, query, onQuery, checks, counts, customDraft, registeredInfo,
  onToggle, onCount, onCustomField, onAddCustom,
  onClose, onSwitchToForm, onApply, saving, changeCount,
}) {
  const totalKinds = groups.reduce((sum, group) => sum + group.items.length, 0);
  const registeredKinds = groups.reduce(
    (sum, group) => sum + group.items.filter((item) => registeredInfo(item).count > 0).length,
    0,
  );

  return (
    <div className="equipment-editor-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="equipment-editor equipment-catalog"
        role="dialog"
        aria-modal="true"
        aria-label="장비 추가 카탈로그"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>장비 카탈로그</h2>
            <p>체크한 설비가 장비 목록에 등록되고, 체크를 해제하면 목록에서 제거됩니다. 개수형은 대수를 조절할 수 있습니다.</p>
          </div>
          <button type="button" className="catalog-close" onClick={onClose} aria-label="닫기"><span className="material-icons">close</span></button>
        </header>

        <div className="catalog-toolbar">
          <label className="catalog-search">
            <span className="material-icons">search</span>
            <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="설비명 또는 공정 검색" />
          </label>
          <span className="catalog-summary">{registeredKinds}/{totalKinds}종 사용</span>
        </div>

        <div className="equipment-catalog-body">
          <div className="catalog-custom">
            <span className="material-icons">add_circle</span>
            <input
              value={customDraft.name}
              onChange={(event) => onCustomField('name', event.target.value)}
              placeholder="카탈로그에 없는 설비명 예: 슬러지펌프"
            />
            <select value={customDraft.process} onChange={(event) => onCustomField('process', event.target.value)}>
              <option value="">공정 선택</option>
              {EQUIPMENT_PROCESS_ORDER.map((process) => <option key={process}>{process}</option>)}
            </select>
            <select value={customDraft.group} onChange={(event) => onCustomField('group', event.target.value)}>
              <option value="">종류 선택</option>
              {EQUIPMENT_TYPE_ORDER.map((type) => <option key={type}>{type}</option>)}
            </select>
            <button type="button" onClick={onAddCustom}>추가 후 체크</button>
          </div>

          {groups.map((group) => {
            const groupRegistered = group.items.filter((item) => registeredInfo(item).count > 0).length;
            const allRegistered = groupRegistered === group.items.length;
            return (
              <section key={group.group} className="catalog-group">
                <header className="catalog-group-header">
                  <h4>{group.group}</h4>
                  <span className={`progress${allRegistered ? ' full' : ''}`}>{groupRegistered}/{group.items.length}</span>
                </header>
                <div className="catalog-grid">
                  {group.items.map((item) => {
                    const info = registeredInfo(item);
                    const exists = info.count > 0;
                    const countable = group.supportsCount;
                    const checked = Boolean(checks[item.key]);
                    const count = Math.min(26, Math.max(1, Number(counts[item.key]) || info.count || 1));
                    const subParts = [item.process];
                    if (exists && !countable) subParts.push(info.numbers.join(', '));
                    return (
                      <div
                        key={item.key}
                        className={`catalog-card${checked ? ' on' : ''}${exists && checked ? ' registered' : ''}`}
                      >
                        <label className="catalog-card-main">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle(group.group, item)}
                            aria-label={`${item.name} ${item.process}`}
                          />
                          <span className="catalog-card-copy">
                            <b className="catalog-card-name">{item.name}</b>
                            <small className="catalog-card-sub">{subParts.join(' · ')}</small>
                          </span>
                        </label>
                        {countable && checked ? (
                          <span className="catalog-stepper">
                            <button
                              type="button"
                              className="step-btn"
                              disabled={count <= 1}
                              onClick={() => onCount(group.group, item, String(count - 1))}
                              aria-label={`${item.name} 대수 감소`}
                            >−</button>
                            <b>{count}</b>
                            <button
                              type="button"
                              className="step-btn"
                              disabled={count >= 26}
                              onClick={() => onCount(group.group, item, String(count + 1))}
                              aria-label={`${item.name} 대수 증가`}
                            >+</button>
                            <small>대</small>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {!groups.length ? <p className="catalog-empty">검색 조건에 맞는 설비가 없습니다.</p> : null}
        </div>

        <footer>
          <button type="button" className="link" onClick={onSwitchToForm}>직접 입력으로 전환</button>
          <div>
            <button type="button" onClick={onClose} disabled={saving}>취소</button>
            <button type="button" className="primary" onClick={onApply} disabled={saving || changeCount === 0}>
              {saving ? '적용 중...' : `변경 ${changeCount}건 적용`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
