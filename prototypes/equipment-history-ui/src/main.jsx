import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const processOrder = ['유량조정조', '혐기조', '무산소조', '포기조', '침전조', '응집반응조', '응집침전조', '방류조'];
const typeOrder = ['펌프류', '교반기류', '브로아류', '약품펌프류', '탱크류', '소독기', '여과기', '계측기류', '감속기', '수조'];
const typeLabels = { '펌프류': '펌프', '교반기류': '교반기', '브로아류': '브로아', '약품펌프류': '약품펌프', '탱크류': '탱크', 소독기: '소독기', 여과기: '여과기', '계측기류': '계측기', 감속기: '감속기', 수조: '수조' };

const initialEquipment = [
  ['유량조정조', '수조', '유량조정조', '1', '1', '유량조정조 본체', '운영 중'],
  ['유량조정조', '펌프류', '원수펌프', 'A', '1', '기본 2대', '운영 중'], ['유량조정조', '펌프류', '원수펌프', 'B', '1', '기본 2대', '운영 중'],
  ['유량조정조', '교반기류', '유량조정조 교반기', '1', '1', '', '운영 중'], ['유량조정조', '계측기류', '유입유량계', '1', '1', '일반 유량계', '운영 중'],
  ['혐기조', '수조', '혐기조', '1', '1', '혐기조 본체', '운영 중'], ['혐기조', '교반기류', '혐기조 교반기', 'A', '1', '기본 1대 · 추가 가능', '운영 중'],
  ['무산소조', '수조', '무산소조', '1', '1', '무산소조 본체', '운영 중'], ['무산소조', '교반기류', '무산소조 교반기', 'A', '1', '기본 1대 · 추가 가능', '운영 중'],
  ['포기조', '수조', '포기조', '1', '1', '포기조 본체', '운영 중'], ['포기조', '브로아류', '포기브로아', 'A', '1', '기본 2대', '운영 중'], ['포기조', '브로아류', '포기브로아', 'B', '1', '기본 2대', '운영 중'],
  ['포기조', '브로아류', '교반브로아', 'A', '1', '기본 2대', '운영 중'], ['포기조', '교반기류', '포기조 교반기', 'A', '1', '기본 2대', '운영 중'],
  ['포기조', '펌프류', '내부반송펌프', 'A', '1', '기본 2대', '운영 중'], ['포기조', '펌프류', '내부반송펌프', 'B', '1', '기본 2대', '점검 필요'], ['포기조', '계측기류', 'DO계', '1', '1', '', '운영 중'], ['포기조', '계측기류', 'PH계', '1', '1', '', '운영 중'],
  ['침전조', '수조', '침전조', '1', '1', '침전조 본체', '운영 중'], ['침전조', '감속기', '침전조 감속기', '1', '1', '', '운영 중'], ['침전조', '펌프류', '외부반송펌프', 'A', '1', '기본 2대', '운영 중'], ['침전조', '펌프류', '외부반송펌프', 'B', '1', '기본 2대', '운영 중'], ['침전조', '계측기류', '외부반송유량계', '1', '1', '', '운영 중'],
  ['응집반응조', '수조', '응집반응조', '1', '1', '비 MBR 공법', '운영 중'], ['응집반응조', '탱크류', '응집제탱크', '1', '1', '', '운영 중'], ['응집반응조', '약품펌프류', '응집제공급펌프', 'A', '1', '기본 2대', '운영 중'], ['응집반응조', '탱크류', '폴리머탱크', '1', '1', '', '운영 중'], ['응집반응조', '약품펌프류', '폴리머공급펌프', 'A', '1', '기본 2대', '운영 중'],
  ['응집침전조', '수조', '응집침전조', '1', '1', '비 MBR 공법', '운영 중'], ['응집침전조', '감속기', '응집침전조 감속기', '1', '1', '', '운영 중'],
  ['방류조', '수조', '방류조', '1', '1', '방류조 본체', '운영 중'], ['방류조', '소독기', 'UV 소독기', '1', '1', '램프·안정기 포함', '운영 중'], ['방류조', '여과기', '여과기', '1', '1', '부속 펌프·밸브 포함', '운영 중'], ['방류조', '펌프류', '방류펌프', 'A', '1', '기본 2대', '운영 중'], ['방류조', '펌프류', '역세펌프', 'A', '1', '기본 2대', '운영 중'], ['방류조', '펌프류', '중수펌프', 'A', '1', '기본 2대', '운영 중'],
].map(([process, type, name, unitNo, quantity, note, status], index) => ({ id: index + 1, process, type, name, unitNo, quantity, note, status }));

const blankItem = { process: '유량조정조', type: '펌프류', name: '', unitNo: 'A', quantity: '1', note: '', status: '운영 중' };

function App() {
  const [items, setItems] = useState(initialEquipment);
  const [viewMode, setViewMode] = useState('process');
  const [selectedId, setSelectedId] = useState(initialEquipment[0].id);
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
      <div className="module-tabs"><button className="active">장비 목록</button><button disabled>고장·수리 이력 <small>준비 중</small></button><button disabled>정기 점검 <small>준비 중</small></button></div>
      <section className="equipment-widget">
        <div className="widget-heading"><div><h2>장비 목록</h2><p>공정 흐름 또는 장비 종류별로 현장 설비를 관리합니다.</p></div><div className="actions"><button onClick={() => setEditor({ ...blankItem })}>＋ 장비 등록</button><button disabled={!selected} onClick={() => setEditor({ ...selected })}>수정</button><button className="danger" disabled={!selected} onClick={deleteSelected}>삭제</button></div></div>
        <div className="control-bar"><div className="view-switch" role="radiogroup" aria-label="목록 보기 기준"><button className={viewMode === 'process' ? 'active' : ''} onClick={() => setViewMode('process')}>공정별 보기</button><button className={viewMode === 'type' ? 'active' : ''} onClick={() => setViewMode('type')}>종류별 보기</button></div><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="장비명, 공정, 종류로 검색" /></label></div>
        {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        <div className="grid-scroll"><table className="equipment-grid"><colgroup><col className="group-column" /><col className="name-column" /><col className="unit-column" /><col className="quantity-column" /><col className="note-column" /><col className="status-column" /><col className="spec-column" /></colgroup><thead><tr><th>{viewMode === 'process' ? '공정' : '장비 종류'}</th><th>장비명</th><th>호기</th><th>수량</th><th>설명 / 구성</th><th>상태</th><th>사양</th></tr></thead><tbody>{groups.map((group) => { const groupItems = filtered.filter((item) => item[viewMode === 'process' ? 'process' : 'type'] === group); if (!groupItems.length) return null; return groupItems.map((item, index) => <tr key={item.id} className={item.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>{index === 0 && <td rowSpan={groupItems.length} className="group-cell"><b>{group}</b><small>{viewMode === 'process' ? `${groupItems.length}개 설비` : typeLabels[group]}</small></td>}<td className="equipment-name"><b>{item.name}</b>{viewMode === 'process' && <small>{item.type}</small>}</td><td>{item.unitNo}</td><td>{item.quantity}대</td><td className="note">{item.note || '—'}</td><td><span className={item.status === '운영 중' ? 'status normal' : 'status inspect'}>{item.status}</span></td><td><button className="spec-button" onClick={(event) => { event.stopPropagation(); setDetail(item); }}>사양 보기</button></td></tr>); })}{filtered.length === 0 && <tr><td colSpan="7" className="empty">검색 조건에 맞는 장비가 없습니다.</td></tr>}</tbody></table></div>
        <footer className="widget-footer"><span>총 <b>{filtered.length}</b>개 장비</span><span>행을 선택한 뒤 수정하거나, <b>사양 보기</b>에서 세부 정보를 등록합니다.</span></footer>
      </section>
    </main>
    <footer className="statusbar">로컬 개발 UI 프로토타입 · 서버 및 데이터베이스 연결 없음</footer>
    {editor && <EquipmentEditor draft={editor} onChange={setEditor} onClose={() => setEditor(null)} onSave={saveItem} />}
    {detail && <SpecificationModal item={detail} onClose={() => setDetail(null)} />}
  </div>;
}

function EquipmentEditor({ draft, onChange, onClose, onSave }) { const update = (key, value) => onChange((current) => ({ ...current, [key]: value })); return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal editor" onMouseDown={(event) => event.stopPropagation()}><header><div><p>장비 목록</p><h2>{draft.id ? '장비 정보 수정' : '장비 등록'}</h2></div><button onClick={onClose}>×</button></header><div className="form-grid"><Field label="공정" value={draft.process} onChange={(value) => update('process', value)} options={processOrder} /><Field label="장비 종류" value={draft.type} onChange={(value) => update('type', value)} options={typeOrder} /><Field label="장비명 *" value={draft.name} onChange={(value) => update('name', value)} /><Field label="호기" value={draft.unitNo} onChange={(value) => update('unitNo', value)} placeholder="예: A, B, 1" /><Field label="수량" value={draft.quantity} onChange={(value) => update('quantity', value)} /><Field label="상태" value={draft.status} onChange={(value) => update('status', value)} options={['운영 중', '점검 필요', '수리 중', '폐기']} /><label className="wide"><span>설명 / 구성</span><textarea value={draft.note} onChange={(event) => update('note', event.target.value)} placeholder="예: 기본 2대, 부속 기기 포함" /></label></div><footer><span>프로토타입에서는 새로고침 시 초기화됩니다.</span><div><button onClick={onClose}>취소</button><button className="primary" disabled={!draft.name.trim()} onClick={onSave}>저장</button></div></footer></section></div>; }
function Field({ label, value, onChange, options, placeholder }) { return <label><span>{label}</span>{options ? <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>; }
function SpecificationModal({ item, onClose }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal specification" onMouseDown={(event) => event.stopPropagation()}><header><div><p>{item.process} · {item.type}</p><h2>{item.name} {item.unitNo}호기</h2></div><button onClick={onClose}>×</button></header><div className="spec-content"><div className="spec-illustration">⚙<span>장비 대표사진</span><small>추후 사진 등록 영역</small></div><dl><div><dt>수량</dt><dd>{item.quantity}대</dd></div><div><dt>운영상태</dt><dd><span className={item.status === '운영 중' ? 'status normal' : 'status inspect'}>{item.status}</span></dd></div><div><dt>구성 / 비고</dt><dd>{item.note || '등록된 설명이 없습니다.'}</dd></div><div><dt>상세 사양</dt><dd className="muted">정격용량, 제조사, 설치일, 모델명 등의 세부 사양은 다음 단계에서 등록합니다.</dd></div></dl></div><footer><span>이 창은 장비별 상세 사양을 관리하는 별도 모달입니다.</span><button className="primary" onClick={onClose}>확인</button></footer></section></div>; }

createRoot(document.getElementById('root')).render(<App />);
