// 장비이력카드 화면. 렌더링만 담당하고 상태/로직은 useEquipmentViewModel을 경유한다.
// 본앱 이식 시 이 파일에서 바뀌는 것은 useDialog import 경로뿐이다.
import React, { useState } from 'react';
import { useDialog } from '../dialog';
import { useEquipmentViewModel } from './useEquipmentViewModel';
import EquipmentEditorModal from './EquipmentEditorModal';
import EquipmentCatalogModal from './EquipmentCatalogModal';
import EquipmentHistoryEditor from './EquipmentHistoryEditor';
import './equipment.css';
import './equipmentEditor.css';

const formatPrice = (value) => {
  const amount = Number(value) || 0;
  return amount ? `${amount.toLocaleString('ko-KR')}원` : '-';
};

const STATUS_CLASS = {
  '사용 중': 'normal',
  '점검 필요': 'inspect',
  '수리 중': 'repair',
  '예비': 'standby',
  '폐기': 'disposed',
};

const TYPE_CLASS = {
  '정기점검': 'check',
  '고장': 'fault',
  '수리': 'repair',
  '부품교체': 'part',
  '위탁': 'consign',
  '기타': 'etc',
};

function DetailRow({ label, value }) {
  return <div className="equipment-detail-row"><dt>{label}</dt><dd>{value || '-'}</dd></div>;
}

function StatCard({ label, value, tone }) {
  return (
    <div className={`equipment-stat${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

// processMethod: 프로토타입 셸(기본설정 시뮬레이션)에서 주입.
// 본앱 이식 시에는 기본설정(app_settings.method) 값을 그대로 주입한다.
export default function EquipmentCardView({ processMethod = 'A2O' }) {
  const { showAlert, showConfirm } = useDialog();
  const vm = useEquipmentViewModel({ processMethod });
  const [bannerOpen, setBannerOpen] = useState(true);

  const handleSaveEquipment = async () => {
    try {
      await vm.saveEquipment();
    } catch (error) {
      await showAlert(error.message);
    }
  };

  const handleAddCustomCatalogItem = () => {
    try {
      vm.addCustomCatalogItem();
    } catch (error) {
      showAlert(error.message);
    }
  };

  const handleApplyCatalog = async () => {
    const removals = vm.catalogRemovalNames;
    if (removals.length) {
      const confirmed = await showConfirm(
        `다음 설비를 목록에서 제거합니다:\n${removals.join(', ')}\n연결된 이력도 함께 제거됩니다. 계속할까요?`,
        '목록에서 제거',
      );
      if (!confirmed) return;
    }
    try {
      await vm.applyCatalogChanges();
    } catch (error) {
      await showAlert(`카탈로그 적용 실패: ${error.message}`);
    }
  };

  const handleDeleteEquipment = async () => {
    const target = vm.selected;
    if (!target) return;
    const confirmed = await showConfirm(
      `'${target.name}' 장비를 삭제할까요?\n연결된 이력도 함께 정리됩니다.`,
      '장비 삭제 확인',
    );
    if (!confirmed) return;
    try {
      await vm.deleteEquipment(target.id);
      vm.closeEquipmentEditor();
    } catch (error) {
      await showAlert(`장비 삭제 실패: ${error.message}`);
    }
  };

  const handleSaveHistory = async () => {
    try {
      await vm.saveHistoryEntry();
    } catch (error) {
      await showAlert(error.message);
    }
  };

  const handleDeleteHistory = async (entry) => {
    const confirmed = await showConfirm('선택한 이력을 삭제할까요?', '이력 삭제 확인');
    if (!confirmed) return;
    try {
      await vm.deleteHistoryEntry(entry.id);
      vm.closeHistoryEditor();
    } catch (error) {
      await showAlert(`이력 삭제 실패: ${error.message}`);
    }
  };

  const equipmentDraft = vm.equipmentEditor.draft;
  const historyDraft = vm.historyEditor.draft;
  const linkedNames = (record) => record.equipmentIds
    .map((id) => vm.items.find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => item.name)
    .join(' · ');

  return (
    <div className="equipment-feature-root">
      {bannerOpen ? (
        <div className="equipment-preview-banner">
          <span className="material-icons">visibility</span>
          <p>장비이력카드 UI 확인 단계입니다. 화면에서 변경한 내용은 서버에 저장되지 않으며 새로고침 시 초기화됩니다.</p>
          <button type="button" onClick={() => setBannerOpen(false)} aria-label="안내 닫기">×</button>
        </div>
      ) : null}

      <div className="equipment-page">
        <aside className="equipment-list-panel">
          <header>
            <div>
              <h2>장비 목록</h2>
              <p>
                현장 설비 {vm.items.length}대
                <span className="equipment-method-badge">{processMethod}</span>
              </p>
            </div>
            <button type="button" className="equipment-add-button" title="장비 추가" onClick={vm.openCatalog}><span className="material-icons">add</span></button>
          </header>
          <label className="equipment-list-search">
            <span className="material-icons">search</span>
            <input value={vm.query} onChange={(event) => vm.setQuery(event.target.value)} placeholder="관리번호 또는 설비명" />
          </label>
          <div className="equipment-view-toggle" role="radiogroup" aria-label="목록 보기 기준">
            <button
              type="button"
              className={vm.groupBy === 'process' ? 'active' : ''}
              onClick={() => vm.setGroupBy('process')}
            >공정별</button>
            <button
              type="button"
              className={vm.groupBy === 'type' ? 'active' : ''}
              onClick={() => vm.setGroupBy('type')}
            >종류별</button>
          </div>
          <div className="equipment-category-strip">
            {vm.categories.map((name) => (
              <button key={name} type="button" className={vm.category === name ? 'active' : ''} onClick={() => vm.setCategory(name)}>{name}</button>
            ))}
          </div>
          <div className="equipment-list-scroll">
            {vm.loading ? (
              <p className="equipment-list-none">불러오는 중...</p>
            ) : vm.grouped.map((group) => (
              <div key={group.name} className="equipment-group">
                <div className="equipment-group-header">
                  <b>{group.name}</b>
                  <small>{group.items.length}</small>
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`equipment-list-item ${vm.selected?.id === item.id ? 'active' : ''}`}
                    onClick={() => vm.selectEquipment(item.id)}
                  >
                    <span className="equipment-list-thumbnail"><span className="material-icons">precision_manufacturing</span></span>
                    <span><b>{item.name}</b><small>{item.managementNo} · {item.location}</small></span>
                    <i className={`equipment-status ${STATUS_CLASS[item.status] || 'normal'}`}>{item.status}</i>
                  </button>
                ))}
              </div>
            ))}
            {!vm.loading && !vm.filtered.length ? <p className="equipment-list-none">검색 결과가 없습니다.</p> : null}
          </div>
        </aside>

        <main className="equipment-card-panel">
          {vm.loading ? (
            <div className="equipment-card-empty">장비 목록을 불러오는 중...</div>
          ) : vm.selected ? (
            <>
              <header className="equipment-card-header">
                <div><span>시설물 이력카드</span><h1>{vm.selected.name}</h1><p>{vm.selected.managementNo} · {vm.selected.category1} / {vm.selected.category3}</p></div>
                <div className="equipment-card-actions">
                  <button type="button" onClick={() => vm.openEditEquipment(vm.selected)}><span className="material-icons">edit</span> 장비 수정</button>
                  <button type="button" className="danger" onClick={handleDeleteEquipment} disabled={vm.saving}><span className="material-icons">delete</span> 삭제</button>
                  <button type="button" disabled title="인쇄는 저장 기능 연결 후 제공됩니다."><span className="material-icons">print</span> 출력</button>
                </div>
              </header>
              <section className="equipment-overview">
                <dl className="equipment-detail-grid">
                  <DetailRow label="관리번호" value={vm.selected.managementNo} />
                  <DetailRow label="설비명" value={vm.selected.name} />
                  <DetailRow label="형식" value={vm.selected.model} />
                  <DetailRow label="사양" value={vm.selected.specification} />
                  <DetailRow label="단위 / 수량" value={`${vm.selected.unit} / ${vm.selected.quantity}`} />
                  <DetailRow label="동력" value={vm.selected.power} />
                  <DetailRow label="설치일자" value={vm.selected.installedAt} />
                  <DetailRow label="납품회사" value={vm.selected.vendor} />
                  <DetailRow label="설치 위치" value={vm.selected.location} />
                  <DetailRow label="부속설비" value={vm.selected.accessory} />
                  <DetailRow label="비고" value={vm.selected.notes} />
                </dl>
                <button type="button" className="equipment-photo-placeholder">
                  {vm.selected.photoName ? (
                    <>
                      <span className="material-icons">image</span>
                      <b>{vm.selected.photoName}</b>
                      <small>대표사진 등록됨</small>
                    </>
                  ) : (
                    <>
                      <span className="material-icons">add_a_photo</span>
                      <b>장비 대표사진</b>
                      <small>클릭하여 사진 등록</small>
                    </>
                  )}
                </button>
              </section>
              <section className="equipment-stats">
                <StatCard label="누적 이력" value={`${vm.stats.historyCount}건`} />
                <StatCard label="누적 유지비용" value={formatPrice(vm.stats.totalCost)} />
                <StatCard label={`${new Date().getFullYear()}년 비용`} value={formatPrice(vm.stats.yearCost)} tone="accent" />
                <StatCard label="최근 이력" value={vm.stats.lastDate || '-'} />
              </section>
              <nav className="equipment-card-tabs">
                <button type="button" className={vm.tab === 'history' ? 'active' : ''} onClick={() => vm.setTab('history')}>장비 이력 <span>{vm.equipmentHistory.length}</span></button>
                <button type="button" className={vm.tab === 'work' ? 'active' : ''} onClick={() => vm.setTab('work')}>연결된 업무·사진 <span>{vm.linkedWorkRecords.length}</span></button>
              </nav>
              {vm.tab === 'history' ? (
                <section className="equipment-history-section">
                  <div className="equipment-history-heading">
                    <div><h3>시설물 유지보수 내역</h3><p>장비 자체 이력을 발생일 순으로 확인합니다.</p></div>
                    <button type="button" onClick={vm.openCreateHistory}><span className="material-icons">add</span> 이력 추가</button>
                  </div>
                  <div className="equipment-history-table-wrap">
                    <table className="equipment-history-table">
                      <thead><tr><th>발생일</th><th>완료일</th><th>구분</th><th>수리·공사내용</th><th>업체 / 연락처</th><th>비용</th><th>사진</th><th>관리</th></tr></thead>
                      <tbody>
                        {vm.equipmentHistory.map((entry) => (
                          <tr key={entry.id}>
                            <td>{entry.date}</td>
                            <td>{entry.completedAt || '-'}</td>
                            <td><span className={`equipment-type-badge ${TYPE_CLASS[entry.type] || 'etc'}`}>{entry.type}</span></td>
                            <td className="left">{entry.content}</td>
                            <td className="left">{entry.company || '-'}{entry.contact ? <small>{entry.contact}</small> : null}</td>
                            <td className="right">{formatPrice(entry.price)}</td>
                            <td>{entry.photoCount ? <button type="button" className="equipment-photo-count"><span className="material-icons">photo_library</span>{entry.photoCount}</button> : '-'}</td>
                            <td>
                              <span className="equipment-row-actions">
                                <button type="button" title="이력 수정" onClick={() => vm.openEditHistory(entry)}><span className="material-icons">edit</span></button>
                                <button type="button" title="이력 삭제" className="danger" onClick={() => handleDeleteHistory(entry)}><span className="material-icons">delete</span></button>
                              </span>
                            </td>
                          </tr>
                        ))}
                        {!vm.equipmentHistory.length ? <tr><td colSpan="8" className="equipment-history-empty">등록된 이력이 없습니다. '이력 추가'로 첫 이력을 남겨 보세요.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <section className="equipment-history-section">
                  <div className="equipment-history-heading">
                    <div><h3>업무사진관리 연결 기록</h3><p>업무사진관리에서 이 장비를 선택해 저장한 기록입니다.</p></div>
                  </div>
                  <div className="equipment-history-table-wrap">
                    <table className="equipment-history-table equipment-work-table">
                      <thead><tr><th>날짜</th><th>제목</th><th>사진</th><th>함께 연결된 장비</th></tr></thead>
                      <tbody>
                        {vm.linkedWorkRecords.map((record) => (
                          <tr key={record.id}>
                            <td>{record.date}</td>
                            <td className="left">{record.title}{record.content ? <small>{record.content}</small> : null}</td>
                            <td>{record.photoCount ? <button type="button" className="equipment-photo-count"><span className="material-icons">photo_library</span>{record.photoCount}</button> : '-'}</td>
                            <td className="left">{linkedNames(record) || '-'}</td>
                          </tr>
                        ))}
                        {!vm.linkedWorkRecords.length ? <tr><td colSpan="4" className="equipment-history-empty">연결된 업무 기록이 없습니다. 업무사진관리에서 '장비 연결'을 선택해 저장하면 이 카드에 나타납니다.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="equipment-card-empty">
              <p>등록된 장비가 없습니다.</p>
              <button type="button" className="equipment-primary-cta" onClick={vm.openCatalog}><span className="material-icons">add</span> 첫 장비 등록</button>
            </div>
          )}
        </main>
      </div>

      {vm.catalogOpen ? (
        <EquipmentCatalogModal
          groups={vm.catalogGroups}
          query={vm.catalogQuery}
          onQuery={vm.setCatalogQuery}
          checks={vm.catalogChecks}
          counts={vm.catalogCounts}
          customDraft={vm.customDraft}
          registeredInfo={vm.registeredInfo}
          changeCount={vm.catalogChangeCount}
          saving={vm.saving}
          onToggle={vm.toggleCatalogItem}
          onCount={vm.setCatalogItemCount}
          onCustomField={vm.setCustomDraftField}
          onAddCustom={handleAddCustomCatalogItem}
          onClose={vm.closeCatalog}
          onSwitchToForm={() => { vm.closeCatalog(); vm.openCreateEquipment(); }}
          onApply={handleApplyCatalog}
        />
      ) : null}

      {vm.equipmentEditor.open ? (
        <EquipmentEditorModal
          draft={equipmentDraft}
          saving={vm.saving}
          onChangeField={vm.setEquipmentDraftField}
          onClose={vm.closeEquipmentEditor}
          onSave={handleSaveEquipment}
          onDelete={handleDeleteEquipment}
        />
      ) : null}

      {vm.historyEditor.open ? (
        <EquipmentHistoryEditor
          draft={historyDraft}
          equipmentName={vm.selected?.name}
          saving={vm.saving}
          onChangeField={vm.setHistoryDraftField}
          onClose={vm.closeHistoryEditor}
          onSave={handleSaveHistory}
          onDelete={() => handleDeleteHistory(historyDraft)}
        />
      ) : null}
    </div>
  );
}
