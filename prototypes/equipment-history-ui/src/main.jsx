import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const processOrder = ['유량조정조', '혐기조', '무산소조', '포기조', '침전조', '응집반응조', '응집침전조', '방류조'];
const typeOrder = ['펌프류', '교반기류', '브로아류', '약품펌프류', '탱크류', '소독기', '여과기', '계측기류', '감속기'];

const initialEquipment = [
  ['유량조정조', '펌프류', '원수펌프', 'A', '1', '기본 2대', '운영 중'], ['유량조정조', '펌프류', '원수펌프', 'B', '1', '기본 2대', '운영 중'],
  ['유량조정조', '교반기류', '유량조정조 교반기', '1', '1', '', '운영 중'], ['유량조정조', '계측기류', '유입유량계', '1', '1', '일반 유량계', '운영 중'],
  ['혐기조', '교반기류', '혐기조 교반기', 'A', '1', '기본 1대 · 추가 가능', '운영 중'],
  ['무산소조', '교반기류', '무산소조 교반기', 'A', '1', '기본 1대 · 추가 가능', '운영 중'],
  ['포기조', '브로아류', '포기브로아', 'A', '1', '기본 2대', '운영 중'], ['포기조', '브로아류', '포기브로아', 'B', '1', '기본 2대', '운영 중'],
  ['포기조', '브로아류', '교반브로아', 'A', '1', '기본 2대', '운영 중'], ['포기조', '교반기류', '포기조 교반기', 'A', '1', '기본 2대', '운영 중'],
  ['포기조', '펌프류', '내부반송펌프', 'A', '1', '기본 2대', '운영 중'], ['포기조', '펌프류', '내부반송펌프', 'B', '1', '기본 2대', '점검 필요'], ['포기조', '계측기류', 'DO계', '1', '1', '', '운영 중'], ['포기조', '계측기류', 'PH계', '1', '1', '', '운영 중'],
  ['침전조', '감속기', '침전조 감속기', '1', '1', '', '운영 중'], ['침전조', '펌프류', '외부반송펌프', 'A', '1', '기본 2대', '운영 중'], ['침전조', '펌프류', '외부반송펌프', 'B', '1', '기본 2대', '운영 중'], ['침전조', '계측기류', '외부반송유량계', '1', '1', '', '운영 중'],
  ['응집반응조', '탱크류', '응집제탱크', '1', '1', '', '운영 중'], ['응집반응조', '약품펌프류', '응집제공급펌프', 'A', '1', '기본 2대', '운영 중'], ['응집반응조', '탱크류', '폴리머탱크', '1', '1', '', '운영 중'], ['응집반응조', '약품펌프류', '폴리머공급펌프', 'A', '1', '기본 2대', '운영 중'],
  ['응집침전조', '감속기', '응집침전조 감속기', '1', '1', '', '운영 중'],
  ['방류조', '소독기', 'UV 소독기', '1', '1', '램프·안정기 포함', '운영 중'], ['방류조', '여과기', '여과기', '1', '1', '부속 펌프·밸브 포함', '운영 중'], ['방류조', '펌프류', '방류펌프', 'A', '1', '기본 2대', '운영 중'], ['방류조', '펌프류', '역세펌프', 'A', '1', '기본 2대', '운영 중'], ['방류조', '펌프류', '중수펌프', 'A', '1', '기본 2대', '운영 중'],
].map(([process, type, name, unitNo, quantity, note, status], index) => ({ id: index + 1, process, type, name, unitNo, quantity, note, status }));

const blankItem = { process: '유량조정조', type: '펌프류', name: '', unitNo: 'A', quantity: '1', note: '', status: '운영 중' };

function App() {
  const [items, setItems] = useState(initialEquipment);
  const [viewMode, setViewMode] = useState('process');
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState(null);
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState('');
  const groups = viewMode === 'process' ? processOrder : typeOrder;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => !keyword || [item.name, item.process, item.type, item.note, item.unitNo].some((value) => value.toLowerCase().includes(keyword)));
  }, [items, query]);
  const selected = items.find((item) => item.id === selectedId);
  const saveItem = () => {
    if (!editor.name.trim()) return;
    if (editor.id) setItems((previous) => previous.map((item) => item.id === editor.id ? { ...editor } : item));
    else { const next = { ...editor, id: Date.now() }; setItems((previous) => [...previous, next]); setSelectedId(next.id); }
    setEditor(null); setNotice('장비 목록에 반영되었습니다. (프로토타입: 새로고침 시 초기화)');
  };
  const deleteSelected = () => {
    if (!selected) return;
    setItems((previous) => previous.filter((item) => item.id !== selected.id));
    setSelectedId(null); setNotice('선택한 장비를 목록에서 제거했습니다. (프로토타입: 새로고침 시 복원)');
  };
  return <div className="prototype-shell">
    <header className="app-header"><div className="app-logo">O</div><b>오수처리 통합관리시스템</b><span>횡성휴게소(강릉방향)</span><div className="user">김동철 · 현장관리자</div></header>
    <aside className="sidebar"><p>업무 메뉴</p>{['대시보드', '유량관리', '약품관리', '수질관리', '키트관리', '성적서', '장비이력', '설정'].map((name) => <button key={name} className={name === '장비이력' ? 'active' : ''}><i>{name === '장비이력' ? '▣' : '○'}</i>{name}</button>)}</aside>
    <main className="workspace">
      <div className="module-tabs"><button className="active">장비 목록</button><button disabled>고장·수리 이력 <small>준비 중</small></button><button disabled>정기 점검 <small>준비 중</small></button><div className="tab-tools"><div className="view-switch" role="radiogroup" aria-label="목록 보기 기준"><button className={viewMode === 'process' ? 'active' : ''} onClick={() => setViewMode('process')}>공정별 보기</button><button className={viewMode === 'type' ? 'active' : ''} onClick={() => setViewMode('type')}>종류별 보기</button></div><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="장비명, 공정, 종류로 검색" /></label></div></div>
      <section className="equipment-widget">
        {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        <div className="equipment-content">
          <div className={viewMode === 'type' ? 'equipment-type-tables' : 'grid-scroll'}>
          {viewMode === 'process' ? groups.map((process) => { const processItems = filtered.filter((item) => item.process === process); return processItems.length ? <section className="equipment-type-section" key={process}><h3>{process}<small>{processItems.length}개 설비</small></h3><EquipmentTable mode="processGroup" items={processItems} selectedId={selectedId} onSelect={setSelectedId} /></section> : null; }) : groups.map((type) => { const typeItems = filtered.filter((item) => item.type === type); return typeItems.length ? <section className="equipment-type-section" key={type}><h3>{type}<small>{typeItems.length}개 설비</small></h3><EquipmentTable mode="type" items={typeItems} selectedId={selectedId} onSelect={setSelectedId} /></section> : null; })}
          {!filtered.length ? <div className="empty-list">검색 조건에 맞는 장비가 없습니다.</div> : null}
          </div>
        </div>
        <footer className="widget-footer"><div><span>총 <b>{filtered.length}</b>개 장비</span><span>{selected ? <><b>{selected.name} {selected.unitNo}호기</b>가 선택되었습니다.</> : '왼쪽 체크칸에서 장비 한 대를 선택하세요.'}</span></div><div className="actions"><button onClick={() => setEditor({ ...blankItem })}>＋ 장비 등록</button><button disabled={!selected} onClick={() => setDetail(selected)}>상세 보기</button><button disabled={!selected} onClick={() => setEditor({ ...selected })}>수정</button><button className="danger" disabled={!selected} onClick={deleteSelected}>삭제</button></div></footer>
      </section>
    </main>
    <footer className="statusbar">로컬 개발 UI 프로토타입 · 서버 및 데이터베이스 연결 없음</footer>
    {editor && <EquipmentEditor draft={editor} onChange={setEditor} onClose={() => setEditor(null)} onSave={saveItem} />}
    {detail && <SpecificationModal item={detail} onClose={() => setDetail(null)} />}
  </div>;
}

function EquipmentTable({ mode, items, selectedId, onSelect }) {
  const isProcessGroup = mode === 'processGroup';
  const renderRow = (item, group, index, groupItems) => <tr key={item.id} className={item.id === selectedId ? 'selected' : ''}>
    <td className="check-cell"><input type="checkbox" aria-label={`${item.name} ${item.unitNo}호기 선택`} checked={item.id === selectedId} onChange={() => onSelect(item.id === selectedId ? null : item.id)} /></td>
    <td className="equipment-name"><b>{item.name}</b></td>
    {(mode === 'type' || isProcessGroup) && <td>{mode === 'type' ? item.process : item.type}</td>}
    <td>{item.unitNo}</td><td>{item.quantity}대</td><td className="note">{item.note || '—'}</td><td><span className={item.status === '운영 중' ? 'status normal' : 'status inspect'}>{item.status}</span></td>
  </tr>;
  return <div className="grid-scroll"><table className="equipment-grid"><colgroup><col className="check-column" /><col className="name-column" />{(mode === 'type' || isProcessGroup) && <col className="process-column" />}<col className="unit-column" /><col className="quantity-column" /><col className="note-column" /><col className="status-column" /></colgroup><thead><tr><th className="check-cell">선택</th><th>장비명</th>{mode === 'type' && <th>설치 공정</th>}{isProcessGroup && <th>장비 종류</th>}<th>호기</th><th>수량</th><th>설명 / 구성</th><th>상태</th></tr></thead><tbody>{items.map((item, index) => renderRow(item, '', index, items))}</tbody></table></div>;
}

function EquipmentEditor({ draft, onChange, onClose, onSave }) { const update = (key, value) => onChange((current) => ({ ...current, [key]: value })); return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal editor" onMouseDown={(event) => event.stopPropagation()}><header><div><p>장비 목록</p><h2>{draft.id ? '장비 정보 수정' : '장비 등록'}</h2></div><button onClick={onClose}>×</button></header><div className="form-grid"><Field label="공정" value={draft.process} onChange={(value) => update('process', value)} options={processOrder} /><Field label="장비 종류" value={draft.type} onChange={(value) => update('type', value)} options={typeOrder} /><Field label="장비명 *" value={draft.name} onChange={(value) => update('name', value)} /><Field label="호기" value={draft.unitNo} onChange={(value) => update('unitNo', value)} placeholder="예: A, B, 1" /><Field label="수량" value={draft.quantity} onChange={(value) => update('quantity', value)} /><Field label="상태" value={draft.status} onChange={(value) => update('status', value)} options={['운영 중', '점검 필요', '수리 중', '폐기']} /><label className="wide"><span>설명 / 구성</span><textarea value={draft.note} onChange={(event) => update('note', event.target.value)} placeholder="예: 기본 2대, 부속 기기 포함" /></label></div><footer><span>프로토타입에서는 새로고침 시 초기화됩니다.</span><div><button onClick={onClose}>취소</button><button className="primary" disabled={!draft.name.trim()} onClick={onSave}>저장</button></div></footer></section></div>; }
function Field({ label, value, onChange, options, placeholder }) { return <label><span>{label}</span>{options ? <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>; }
function SpecificationModal({ item, onClose }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal specification" onMouseDown={(event) => event.stopPropagation()}><header><div><p>{item.process} · {item.type}</p><h2>{item.name} {item.unitNo}호기</h2></div><button onClick={onClose}>×</button></header><div className="spec-content"><div className="spec-illustration">⚙<span>장비 대표사진</span><small>추후 사진 등록 영역</small></div><dl><div><dt>수량</dt><dd>{item.quantity}대</dd></div><div><dt>운영상태</dt><dd><span className={item.status === '운영 중' ? 'status normal' : 'status inspect'}>{item.status}</span></dd></div><div><dt>구성 / 비고</dt><dd>{item.note || '등록된 설명이 없습니다.'}</dd></div><div><dt>상세 사양</dt><dd className="muted">정격용량, 제조사, 설치일, 모델명 등의 세부 사양은 다음 단계에서 등록합니다.</dd></div></dl></div><footer><span>이 창은 장비별 상세 사양을 관리하는 별도 모달입니다.</span><button className="primary" onClick={onClose}>확인</button></footer></section></div>; }

createRoot(document.getElementById('root')).render(<App />);
