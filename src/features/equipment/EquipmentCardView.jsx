import React, { useMemo, useState } from 'react';
import { EQUIPMENT_HISTORY_PREVIEW, EQUIPMENT_PREVIEW_ITEMS } from './equipmentPreviewData';
import './equipment.css';
import './equipmentEditor.css';

const formatPrice = (value) => value ? `${Number(value).toLocaleString('ko-KR')}원` : '-';
const emptyEquipment = () => ({
  id: '', managementNo: '', category1: '', category2: '', category3: '기계', category4: '',
  name: '', model: '', specification: '', unit: '대', quantity: 1, power: '', installedAt: '',
  vendor: '', location: '', accessory: '', status: '사용 중', photoName: '',
});

function DetailRow({ label, value }) {
  return <div className="equipment-detail-row"><dt>{label}</dt><dd>{value || '-'}</dd></div>;
}

export default function EquipmentCardView() {
  const [items, setItems] = useState(EQUIPMENT_PREVIEW_ITEMS);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(EQUIPMENT_PREVIEW_ITEMS[0]?.id || null);
  const [tab, setTab] = useState('history');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(emptyEquipment);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => [item.managementNo, item.name, item.location, item.category3]
      .some((field) => String(field || '').toLowerCase().includes(keyword)));
  }, [items, query]);
  const selected = items.find((item) => item.id === selectedId) || filtered[0];
  const history = EQUIPMENT_HISTORY_PREVIEW.filter((item) => item.equipmentId === selected?.id);

  const openCreate = () => {
    setDraft(emptyEquipment());
    setEditorOpen(true);
  };
  const openEdit = () => {
    if (!selected) return;
    setDraft({ ...emptyEquipment(), ...selected });
    setEditorOpen(true);
  };
  const updateDraft = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }));
  const savePreview = () => {
    if (!draft.managementNo.trim() || !draft.name.trim()) return;
    const next = { ...draft, id: draft.id || `preview-${Date.now()}`, quantity: Number(draft.quantity) || 1 };
    setItems((previous) => draft.id ? previous.map((item) => item.id === draft.id ? next : item) : [...previous, next]);
    setSelectedId(next.id);
    setEditorOpen(false);
  };

  return (
    <div className="equipment-page">
      <aside className="equipment-list-panel">
        <header>
          <div><h2>장비 목록</h2><p>현장 설비 {items.length}대</p></div>
          <button type="button" className="equipment-add-button" title="장비 추가" onClick={openCreate}><span className="material-icons">add</span></button>
        </header>
        <label className="equipment-list-search">
          <span className="material-icons">search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="관리번호 또는 설비명" />
        </label>
        <div className="equipment-category-strip">
          <button type="button" className="active">전체</button><button type="button">기계</button><button type="button">전기</button><button type="button">계측기</button>
        </div>
        <div className="equipment-list-scroll">
          {filtered.map((item) => (
            <button key={item.id} type="button" className={`equipment-list-item ${selected?.id === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
              <span className="equipment-list-thumbnail"><span className="material-icons">precision_manufacturing</span></span>
              <span><b>{item.name}</b><small>{item.managementNo} · {item.location}</small></span>
              <i>{item.status}</i>
            </button>
          ))}
          {!filtered.length ? <p className="equipment-list-none">검색 결과가 없습니다.</p> : null}
        </div>
      </aside>

      <main className="equipment-card-panel">
        {selected ? (
          <>
            <header className="equipment-card-header">
              <div><span>시설물 이력카드</span><h1>{selected.name}</h1><p>{selected.managementNo} · {selected.category1} / {selected.category3}</p></div>
              <div className="equipment-card-actions"><button type="button" onClick={openEdit}><span className="material-icons">edit</span> 장비 수정</button><button type="button"><span className="material-icons">print</span> 출력</button></div>
            </header>
            <section className="equipment-overview">
              <dl className="equipment-detail-grid">
                <DetailRow label="관리번호" value={selected.managementNo} />
                <DetailRow label="설비명" value={selected.name} />
                <DetailRow label="형식" value={selected.model} />
                <DetailRow label="사양" value={selected.specification} />
                <DetailRow label="단위 / 수량" value={`${selected.unit} / ${selected.quantity}`} />
                <DetailRow label="동력" value={selected.power} />
                <DetailRow label="설치일자" value={selected.installedAt} />
                <DetailRow label="납품회사" value={selected.vendor} />
                <DetailRow label="부속설비" value={selected.accessory} />
              </dl>
              <button type="button" className="equipment-photo-placeholder">
                <span className="material-icons">add_a_photo</span><b>장비 대표사진</b><small>클릭하여 사진 등록</small>
              </button>
            </section>
            <nav className="equipment-card-tabs">
              <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>장비 이력 <span>{history.length}</span></button>
              <button type="button" className={tab === 'work' ? 'active' : ''} onClick={() => setTab('work')}>연결된 업무·사진 <span>{history.filter((item) => item.source === '업무사진관리').length}</span></button>
            </nav>
            <section className="equipment-history-section">
              <div className="equipment-history-heading">
                <div><h3>{tab === 'history' ? '시설물 유지보수 내역' : '업무사진관리 연결 기록'}</h3><p>{tab === 'history' ? '장비 자체 이력과 연결된 업무를 날짜순으로 확인합니다.' : '업무사진관리에서 이 장비를 선택한 기록만 표시합니다.'}</p></div>
                <button type="button"><span className="material-icons">add</span> 이력 추가</button>
              </div>
              <div className="equipment-history-table-wrap">
                <table className="equipment-history-table">
                  <thead><tr><th>발생일</th><th>완료일</th><th>구분</th><th>수리·공사내용</th><th>업체 / 연락처</th><th>비용</th><th>사진</th></tr></thead>
                  <tbody>
                    {history.filter((item) => tab === 'history' || item.source === '업무사진관리').map((item) => (
                      <tr key={item.id}><td>{item.date}</td><td>{item.completedAt}</td><td><span className={`equipment-source ${item.source === '업무사진관리' ? 'linked' : ''}`}>{item.source}</span></td><td className="left">{item.content}</td><td className="left">{item.company}<small>{item.contact}</small></td><td className="right">{formatPrice(item.price)}</td><td>{item.photoCount ? <button type="button" className="equipment-photo-count"><span className="material-icons">photo_library</span>{item.photoCount}</button> : '-'}</td></tr>
                    ))}
                    {!history.length ? <tr><td colSpan="7" className="equipment-history-empty">등록된 이력이 없습니다.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : <div className="equipment-card-empty">왼쪽에서 장비를 선택하세요.</div>}
      </main>
      {editorOpen ? (
        <div className="equipment-editor-backdrop" role="presentation" onMouseDown={() => setEditorOpen(false)}>
          <div className="equipment-editor" role="dialog" aria-modal="true" aria-label={draft.id ? '장비 수정' : '장비 추가'} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>{draft.id ? '장비 정보 수정' : '새 장비 추가'}</h2><p>장비이력카드의 기준이 되는 설비 기본정보를 입력합니다.</p></div><button type="button" onClick={() => setEditorOpen(false)}>×</button></header>
            <div className="equipment-editor-body">
              <div className="equipment-editor-grid">
                <label><span>관리번호 <b>*</b></span><input autoFocus value={draft.managementNo} onChange={(e) => updateDraft('managementNo', e.target.value)} placeholder="예: M-204" /></label>
                <label><span>설비명 <b>*</b></span><input value={draft.name} onChange={(e) => updateDraft('name', e.target.value)} placeholder="예: 하수이송펌프 토출밸브" /></label>
                <label><span>구분 1</span><input value={draft.category1} onChange={(e) => updateDraft('category1', e.target.value)} placeholder="저류조" /></label>
                <label><span>구분 2</span><input value={draft.category2} onChange={(e) => updateDraft('category2', e.target.value)} placeholder="저류시설" /></label>
                <label><span>구분 3</span><select value={draft.category3} onChange={(e) => updateDraft('category3', e.target.value)}><option>기계</option><option>전기</option><option>계측기</option><option>기타</option></select></label>
                <label><span>구분 4</span><input value={draft.category4} onChange={(e) => updateDraft('category4', e.target.value)} /></label>
                <label><span>형식</span><input value={draft.model} onChange={(e) => updateDraft('model', e.target.value)} /></label>
                <label><span>사양</span><input value={draft.specification} onChange={(e) => updateDraft('specification', e.target.value)} /></label>
                <label><span>단위</span><input value={draft.unit} onChange={(e) => updateDraft('unit', e.target.value)} /></label>
                <label><span>수량</span><input type="number" min="0" value={draft.quantity} onChange={(e) => updateDraft('quantity', e.target.value)} /></label>
                <label><span>동력</span><input value={draft.power} onChange={(e) => updateDraft('power', e.target.value)} placeholder="예: 0.75 kW" /></label>
                <label><span>설치일자</span><input type="month" value={draft.installedAt} onChange={(e) => updateDraft('installedAt', e.target.value)} /></label>
                <label><span>납품회사</span><input value={draft.vendor} onChange={(e) => updateDraft('vendor', e.target.value)} /></label>
                <label><span>설치 위치</span><input value={draft.location} onChange={(e) => updateDraft('location', e.target.value)} /></label>
                <label className="wide"><span>부속설비</span><input value={draft.accessory} onChange={(e) => updateDraft('accessory', e.target.value)} /></label>
                <label><span>상태</span><select value={draft.status} onChange={(e) => updateDraft('status', e.target.value)}><option>사용 중</option><option>수리 중</option><option>예비</option><option>폐기</option></select></label>
              </div>
              <label className="equipment-editor-photo"><span className="material-icons">add_photo_alternate</span><b>{draft.photoName || '대표사진 선택'}</b><small>장비 전체 모습이나 명판 사진을 등록하세요.</small><input type="file" accept="image/*" onChange={(e) => updateDraft('photoName', e.target.files?.[0]?.name || '')} /></label>
            </div>
            <footer><span>현재 단계에서는 화면 동작만 확인하며 서버에는 저장되지 않습니다.</span><div><button type="button" onClick={() => setEditorOpen(false)}>취소</button><button type="button" className="primary" disabled={!draft.managementNo.trim() || !draft.name.trim()} onClick={savePreview}>{draft.id ? '수정 적용' : '장비 추가'}</button></div></footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
