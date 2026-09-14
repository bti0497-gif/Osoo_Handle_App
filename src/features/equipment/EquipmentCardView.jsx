// 장비이력카드 화면. 렌더링만 담당하고 상태/로직은 useEquipmentViewModel을 경유한다.
import React, { useRef } from 'react';
import { useDialog } from '../../components/common/DialogContext';
import { useEquipmentViewModel } from './useEquipmentViewModel';
import EquipmentEditorModal from './EquipmentEditorModal';
import EquipmentCatalogModal from './EquipmentCatalogModal';
import EquipmentHistoryEditor from './EquipmentHistoryEditor';
import HistoryPhotoViewer from './HistoryPhotoViewer';
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
  '철거': 'removed',
  '폐기': 'disposed',
};

const TYPE_CLASS = {
  '고장발생': 'fault',
  '수리의뢰': 'request',
  '수리&재설치': 'repair',
  '교체': 'part',
  '정기점검': 'check',
  '기타': 'etc',
};

function DetailRow({ label, value, wide }) {
  return <div className={`equipment-detail-row${wide ? ' wide' : ''}`}><dt>{label}</dt><dd>{value || '-'}</dd></div>;
}

function StatCard({ label, value, tone }) {
  return (
    <div className={`equipment-stat${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export default function EquipmentCardView() {
  const { showAlert, showConfirm } = useDialog();
  const vm = useEquipmentViewModel();
  const photoInputRef = useRef(null);

  const handleSaveEquipment = async () => {
    try {
      await vm.saveEquipment();
    } catch (error) {
      await showAlert(error.message);
    }
  };

  const handleDeleteEquipment = async () => {
    const target = vm.selected;
    if (!target) return;
    const confirmed = await showConfirm(
      `'${target.name}' 장비를 삭제할까요?`,
      '장비 삭제 확인',
    );
    if (!confirmed) return;
    try {
      await vm.deleteEquipment(target.id);
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

  const handleOpenWorkPhotos = async (record) => {
    try {
      await vm.openWorkPhotoViewer(record);
    } catch (error) {
      await showAlert(`사진을 불러오지 못했습니다: ${error.message}`);
    }
  };

  const handleApplyCatalog = async () => {
    const removals = vm.catalogRemovals || [];
    const toDelete = removals.filter((unit) => !unit.hasHistory).map((unit) => unit.number);
    const toHide = removals.filter((unit) => unit.hasHistory).map((unit) => unit.number);
    if (removals.length) {
      let message = '';
      if (toDelete.length) message += `다음 항목을 목록에서 제거합니다:\n${toDelete.join(', ')}\n\n`;
      if (toHide.length) message += `다음은 유지보수 이력이 있어 삭제하지 않고\n목록에서만 숨깁니다(이력 보존):\n${toHide.join(', ')}\n`;
      const confirmed = await showConfirm(`${message}\n계속할까요?`, '장비 목록 변경');
      if (!confirmed) return;
    }
    try {
      await vm.applyCatalogChanges();
    } catch (error) {
      await showAlert(`카탈로그 적용 실패: ${error.message}`);
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
    } catch (error) {
      await showAlert(`이력 삭제 실패: ${error.message}`);
    }
  };

  const handleCloseEquipment = () => vm.requestCloseEquipment(showConfirm);
  const handleCloseHistory = () => vm.requestCloseHistory(showConfirm);

  const equipmentDraft = vm.equipmentEditor.draft;
  const historyDraft = vm.historyEditor.draft;
  const storedHistoryPhotoCount = historyDraft?.id
    ? (vm.historyPhotoUrls[historyDraft.id]?.length || 0)
    : 0;
  const pendingHistoryPhotoCount = vm.historyDraftPhotos.length;
  const historyPhotoSummary = pendingHistoryPhotoCount > 0
    ? `${pendingHistoryPhotoCount}장 선택됨${storedHistoryPhotoCount ? ` · 기존 ${storedHistoryPhotoCount}장` : ''}`
    : (storedHistoryPhotoCount ? `저장된 사진 ${storedHistoryPhotoCount}장` : '현장 사진 선택');
  const selectedPhotoUrl = vm.photoUrls[vm.selected?.id];

  return (
    <div className="equipment-feature-root">
      <div className="equipment-page">
        <aside className="equipment-list-panel">
          <header>
            <div className="equipment-panel-title">
              <h2>장비 목록</h2>
              <span className="equipment-method-badge">{vm.processMethod}</span>
            </div>
            <button type="button" className="equipment-manage-button" onClick={vm.openCatalog}>장비목록 관리</button>
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
            {vm.hiddenCount > 0 ? (
              <button
                type="button"
                className={`equipment-hidden-toggle${vm.showHidden ? ' on' : ''}`}
                onClick={vm.toggleShowHidden}
                title="목록에서 숨긴 장비 표시 전환"
              >숨김 {vm.hiddenCount}</button>
            ) : null}
          </div>
          <div className="equipment-list-scroll">
            {vm.selectedOutsideFilter ? (
              <div className="equipment-filter-notice">
                <span>선택한 장비가 현재 검색·필터에 없습니다.</span>
                <button type="button" onClick={vm.clearFilters}>필터 해제</button>
              </div>
            ) : null}
            {vm.loading ? (
              <p className="equipment-list-none">불러오는 중...</p>
            ) : vm.loadError ? (
              <p className="equipment-list-none">장비 목록 조회 실패</p>
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
                    <b>{item.name}</b>
                    <i className={`equipment-status ${STATUS_CLASS[item.status] || 'normal'}`}>{item.status}</i>
                  </button>
                ))}
              </div>
            ))}
            {!vm.loading && !vm.loadError && !vm.filtered.length ? <p className="equipment-list-none">검색 결과가 없습니다.</p> : null}
          </div>
        </aside>

        <main className="equipment-card-panel">
          {vm.loadError ? (
            <div className="equipment-load-error">
              <p>장비 정보를 불러오지 못했습니다.</p>
              <button type="button" onClick={vm.reload}>다시 시도</button>
            </div>
          ) : null}
          {!vm.loadError && vm.loading ? (
            <div className="equipment-card-empty">장비 목록을 불러오는 중...</div>
          ) : null}
          {!vm.loadError && !vm.loading && vm.selected ? (
            <>
              <header className="equipment-card-header">
                <div><h1>{vm.selected.name}</h1><p>{vm.selected.managementNo} · {vm.selected.category2 || vm.selected.category3}</p></div>
                <div className="equipment-card-actions">
                  <button type="button" onClick={() => vm.openEditEquipment(vm.selected)}><span className="material-icons">edit</span> 장비 수정</button>
                  <button type="button" className="danger" onClick={handleDeleteEquipment} disabled={vm.saving}><span className="material-icons">delete</span> 삭제</button>
                  <button type="button" disabled title="인쇄는 후속 단계에서 제공됩니다."><span className="material-icons">print</span> 출력</button>
                </div>
              </header>
              <section className="equipment-overview">
                <dl className="equipment-detail-grid">
                  <DetailRow label="형식" value={vm.selected.model} />
                  <DetailRow label="사양" value={vm.selected.specification} />
                  <DetailRow label="동력" value={vm.selected.power} />
                  <DetailRow label="설치일자" value={vm.selected.installedAt} />
                  <DetailRow label="납품회사" value={vm.selected.vendor} />
                  <DetailRow label="부속설비" value={vm.selected.accessory} />
                  <DetailRow label="비고" value={vm.selected.notes} />
                </dl>
                <button
                  type="button"
                  className="equipment-photo-placeholder"
                  title={selectedPhotoUrl ? '사진 크게 보기' : '대표사진 선택'}
                  onClick={() => selectedPhotoUrl ? vm.openEquipmentPhotoViewer() : photoInputRef.current?.click()}
                >
                  {selectedPhotoUrl ? (
                    <>
                      <img src={selectedPhotoUrl} alt="장비 대표사진" className="equipment-photo-image" />
                      <small className="equipment-photo-hint">클릭하여 크게 보기</small>
                    </>
                  ) : (
                    <>
                      <span className="material-icons">add_a_photo</span>
                      <b>장비 대표사진</b>
                      <small>클릭하여 사진 등록</small>
                    </>
                  )}
                </button>
                {selectedPhotoUrl && <button type="button" onClick={() => photoInputRef.current?.click()}>대표사진 교체</button>}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) vm.uploadEquipmentPhoto(vm.selected.id, file).catch((error) => showAlert(`사진 저장 실패: ${error.message}`));
                  }}
                />
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
                            <td>{entry.completed_at || '-'}</td>
                            <td><span className={`equipment-type-badge ${TYPE_CLASS[entry.type] || 'etc'}`}>{entry.type}</span></td>
                            <td className="left">{entry.content}</td>
                            <td className="left">{entry.company || '-'}{entry.contact ? <small>{entry.contact}</small> : null}</td>
                            <td className="right">{formatPrice(entry.price)}</td>
                            <td>
                              {Number(entry.photo_count) > 0 ? (
                                <button type="button" className="equipment-photo-count" title="사진 보기" onClick={() => vm.openPhotoViewer(entry)}>
                                  <span className="material-icons">photo_library</span>{entry.photo_count}
                                </button>
                              ) : '-'}
                            </td>
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
                            <td>{Number(record.photo_count) > 0 ? (
                              <button type="button" className="equipment-photo-count" title="사진 보기" onClick={() => handleOpenWorkPhotos(record)}><span className="material-icons">photo_library</span>{record.photo_count}</button>
                            ) : '-'}</td>
                            <td className="left">{(record.linked_equipment_ids || '').split(',').length}대 연결</td>
                          </tr>
                        ))}
                        {!vm.linkedWorkRecords.length ? <tr><td colSpan="4" className="equipment-history-empty">연결된 업무 기록이 없습니다. 업무사진관리에서 '장비 연결'을 선택해 저장하면 이 카드에 나타납니다.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          ) : null}
          {!vm.loadError && !vm.loading && !vm.selected ? (
            <div className="equipment-card-empty">
              {vm.items.length > 0 ? (
                <>
                  <p>왼쪽 목록에서 장비를 선택하세요.</p>
                  {vm.hiddenCount > 0 ? <small style={{ color: '#94a3b8' }}>목록에서 숨긴 장비 {vm.hiddenCount}대는 '숨김' 칩으로 볼 수 있습니다.</small> : null}
                </>
              ) : (
                <>
                  <p>등록된 장비가 없습니다.</p>
                  <button type="button" className="equipment-primary-cta" onClick={vm.openCatalog}><span className="material-icons">add</span> 첫 장비 등록</button>
                </>
              )}
            </div>
          ) : null}
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
          onPhotoFile={vm.setEquipmentDraftPhoto}
          onClose={handleCloseEquipment}
          onSave={handleSaveEquipment}
          onDelete={handleDeleteEquipment}
        />
      ) : null}

      {vm.historyEditor.open ? (
        <EquipmentHistoryEditor
          draft={historyDraft}
          equipmentName={vm.selected?.name}
          saving={vm.saving}
          photoSummary={historyPhotoSummary}
          onPhotosFiles={vm.addHistoryDraftPhotos}
          onChangeField={vm.setHistoryDraftField}
          onClose={handleCloseHistory}
          onSave={handleSaveHistory}
          onDelete={() => handleDeleteHistory(historyDraft)}
        />
      ) : null}

      {vm.viewer.open ? (
        <HistoryPhotoViewer
          title={vm.viewer.workTitle || ((vm.historyEntries.find((entry) => entry.id === vm.viewer.entryId) || {}).date || '')}
          items={vm.viewer.items.length ? vm.viewer.items : (vm.historyPhotoUrls[vm.viewer.entryId] || [])}
          readOnly={vm.viewer.entryId === null}
          index={vm.viewer.index}
          onSelect={vm.viewerSelect}
          onDelete={vm.viewerDelete}
          onAddFiles={vm.viewerAddFiles}
          onClose={vm.closePhotoViewer}
        />
      ) : null}
    </div>
  );
}
