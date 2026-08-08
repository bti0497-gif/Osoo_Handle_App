import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const initialEquipment = [
  { id: 1, no: 'M-101', category: '기계', name: '통합방류조 유량조절수문', model: '일체형 MOP', spec: '전동 버터플라이 수문', unit: '대', qty: 1, power: '2.2 kW', installed: '2020-10', vendor: '(주)신정기공', location: '통합방류조', accessory: '일체형 MOP', status: '사용 중' },
  { id: 2, no: 'M-203', category: '기계', name: '하수이송펌프', model: '수중펌프', spec: '30㎥/h', unit: '대', qty: 5, power: '30 kW', installed: '2020-10', vendor: '(주)동원펌프', location: '저류조', accessory: '', status: '사용 중' },
  { id: 3, no: 'M-204', category: '기계', name: '하수이송펌프 토출밸브', model: '전동 버터플라이 밸브', spec: '250A × 7.5kg/㎠', unit: '대', qty: 5, power: '0.75 kW', installed: '2020-10', vendor: '(주)신정기공', location: '저류조', accessory: '일체형 MOP', status: '사용 중' },
  { id: 4, no: 'LT-202', category: '계측기', name: '하수저류조 #1 수위계', model: '초음파 수위계', spec: '0~10m', unit: '대', qty: 1, power: '-', installed: '2020-10', vendor: '(주)리테크', location: '하수저류조 #1', accessory: '', status: '사용 중' },
  { id: 5, no: 'FT-101', category: '계측기', name: '유입유량계', model: '전자식 유량계', spec: '200A', unit: '대', qty: 1, power: '-', installed: '2020-10', vendor: '니브스코리아(주)', location: '유입동', accessory: '', status: '점검 필요' },
  { id: 6, no: 'EL-1', category: '전기', name: 'UPS', model: '무정전 전원장치', spec: '10kVA', unit: '대', qty: 1, power: '-', installed: '2020-04', vendor: '그린파워테크놀러지', location: '전기실', accessory: '', status: '사용 중' },
];

const history = [
  { id: 1, equipmentId: 3, occurred: '2026-03-12', completed: '2026-03-13', type: '위탁', content: '밸브 구동부 점검 및 리미트 스위치 교체', company: '신정기공 / 김현수', phone: '010-1234-5678', cost: 450000, photos: 4 },
  { id: 2, equipmentId: 3, occurred: '2025-08-07', completed: '2025-08-07', type: '직영', content: '개폐 상태 점검 및 구리스 주입', company: '현장 자체 작업', phone: '-', cost: 0, photos: 2 },
  { id: 3, equipmentId: 4, occurred: '2026-01-18', completed: '2026-01-21', type: '위탁', content: '수위계 센서 교정 및 케이블 교체', company: '리테크 / 박정우', phone: '010-5678-1234', cost: 720000, photos: 3 },
];

const emptyDraft = { no: '', category: '기계', name: '', model: '', spec: '', unit: '대', qty: 1, power: '', installed: '', vendor: '', location: '', accessory: '', status: '사용 중' };

function App() {
  const [items, setItems] = useState(initialEquipment);
  const [selectedId, setSelectedId] = useState(3);
  const [screen, setScreen] = useState('list');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [editor, setEditor] = useState(null);
  const [linked, setLinked] = useState([3]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const filtered = useMemo(() => items.filter((item) => {
    const matchesCategory = category === '전체' || item.category === category;
    const keyword = query.trim().toLowerCase();
    return matchesCategory && (!keyword || [item.no, item.name, item.location, item.vendor].some((value) => value.toLowerCase().includes(keyword)));
  }), [items, category, query]);
  const selectedHistory = history.filter((item) => item.equipmentId === selected?.id);

  const saveDraft = () => {
    if (!editor.no.trim() || !editor.name.trim()) return;
    if (editor.id) setItems((prev) => prev.map((item) => item.id === editor.id ? editor : item));
    else {
      const next = { ...editor, id: Date.now(), qty: Number(editor.qty) || 1 };
      setItems((prev) => [...prev, next]);
      setSelectedId(next.id);
    }
    setEditor(null);
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">O</span><div><b>오수처리 통합관리시스템</b><small>장비이력카드 UI 프로토타입 · 서버 저장 없음</small></div></div>
      <div className="site-chip">횡성휴게소(강릉방향)</div>
    </header>
    <nav className="screen-tabs">
      <button className={screen === 'list' ? 'active' : ''} onClick={() => setScreen('list')}>장비 목록·관리</button>
      <button className={screen === 'card' ? 'active' : ''} onClick={() => setScreen('card')}>시설물 이력카드</button>
      <button className={screen === 'work' ? 'active' : ''} onClick={() => setScreen('work')}>업무사진 연결 예시</button>
    </nav>

    {screen === 'list' && <main className="content">
      <section className="page-heading"><div><p>시설관리</p><h1>장비 목록</h1><span>현장의 장비 기본정보와 상태를 한곳에서 관리합니다.</span></div><button className="primary" onClick={() => setEditor({ ...emptyDraft })}>＋ 장비 추가</button></section>
      <section className="summary-grid">
        <Summary label="전체 장비" value={`${items.length}대`} tone="blue" />
        <Summary label="사용 중" value={`${items.filter(x => x.status === '사용 중').length}대`} tone="green" />
        <Summary label="점검 필요" value={`${items.filter(x => x.status !== '사용 중').length}대`} tone="orange" />
        <Summary label="이번 달 정비" value="2건" tone="purple" />
      </section>
      <section className="panel">
        <div className="toolbar"><div className="search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="관리번호, 설비명, 위치, 납품회사 검색" /></div><div className="filters">{['전체', '기계', '전기', '계측기'].map(x => <button key={x} className={category === x ? 'active' : ''} onClick={() => setCategory(x)}>{x}</button>)}</div></div>
        <div className="table-wrap"><table><thead><tr><th>관리번호</th><th>구분</th><th>설비명</th><th>설치 위치</th><th>수량</th><th>동력</th><th>설치일자</th><th>납품회사</th><th>상태</th><th></th></tr></thead><tbody>{filtered.map(item => <tr key={item.id} className={item.id === selectedId ? 'selected-row' : ''} onClick={() => setSelectedId(item.id)}><td><b className="number">{item.no}</b></td><td>{item.category}</td><td><b>{item.name}</b><small>{item.model}</small></td><td>{item.location}</td><td>{item.qty}{item.unit}</td><td>{item.power}</td><td>{item.installed}</td><td>{item.vendor}</td><td><span className={`status ${item.status === '사용 중' ? 'ok' : 'warn'}`}>{item.status}</span></td><td><button className="more" onClick={(e) => { e.stopPropagation(); setEditor({ ...item }); }}>수정</button></td></tr>)}</tbody></table></div>
        <footer className="panel-footer">총 {filtered.length}개 장비 <span>행을 클릭하면 이력카드가 선택됩니다.</span><button onClick={() => setScreen('card')}>선택 장비 이력카드 보기 →</button></footer>
      </section>
    </main>}

    {screen === 'card' && <main className="content card-page">
      <section className="page-heading"><div><p>시설관리 / 장비 목록</p><h1>시설물 이력카드</h1><span>장비 기본정보와 유지보수 이력을 함께 확인합니다.</span></div><div className="heading-actions"><select value={selectedId} onChange={e => setSelectedId(Number(e.target.value))}>{items.map(item => <option value={item.id} key={item.id}>{item.no} · {item.name}</option>)}</select><button onClick={() => setEditor({ ...selected })}>정보 수정</button><button className="primary">인쇄 미리보기</button></div></section>
      <section className="history-card">
        <div className="card-title"><div><span>관리번호</span><b>{selected.no}</b></div><h2>시설물 이력카드</h2><span className={`status ${selected.status === '사용 중' ? 'ok' : 'warn'}`}>{selected.status}</span></div>
        <div className="overview"><div className="detail-grid">{[['설비명', selected.name], ['형식', selected.model], ['사양', selected.spec], ['단위', selected.unit], ['수량', selected.qty], ['동력', selected.power], ['설치일자', selected.installed], ['납품회사', selected.vendor], ['설치 위치', selected.location], ['부속설비', selected.accessory || '-']].map(([label, value]) => <div className="detail" key={label}><span>{label}</span><b>{value}</b></div>)}</div><button className="photo-box"><span>▧</span><b>장비 대표사진</b><small>클릭하여 사진 선택</small></button></div>
        <div className="history-heading"><div><h3>시설물 유지보수 내역</h3><p>업무사진관리에서 장비를 연결한 기록도 자동으로 이곳에 표시됩니다.</p></div><button className="primary">＋ 이력 직접 추가</button></div>
        <div className="table-wrap"><table><thead><tr><th>No</th><th>고장발생일</th><th>수리완료일</th><th>직영/위탁</th><th>수리 내용</th><th>관련업체명 / 담당자</th><th>연락처</th><th>수리비용</th><th>사진</th></tr></thead><tbody>{selectedHistory.length ? selectedHistory.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.occurred}</td><td>{row.completed}</td><td><span className="type-chip">{row.type}</span></td><td className="left">{row.content}</td><td>{row.company}</td><td>{row.phone}</td><td>{row.cost ? `${row.cost.toLocaleString()}원` : '-'}</td><td><button className="photo-count">사진 {row.photos}</button></td></tr>) : <tr><td colSpan="9" className="empty">등록된 유지보수 이력이 없습니다.</td></tr>}</tbody></table></div>
      </section>
    </main>}

    {screen === 'work' && <main className="content narrow">
      <section className="page-heading"><div><p>시설관리 / 업무사진관리</p><h1>업무 기록 추가</h1><span>일반 업무는 장비를 선택하지 않아도 됩니다. 장비 관련 작업일 때만 연결합니다.</span></div></section>
      <section className="work-form panel"><div className="form-grid"><label><span>작업일자</span><input type="date" defaultValue="2026-08-08" /></label><label><span>업무 구분</span><select><option>시설 점검</option><option>고장 수리</option><option>청소 및 정비</option></select></label><label className="wide"><span>업무 내용</span><textarea defaultValue="저류조 토출밸브 개폐 상태 점검 및 구리스 주입" /></label></div>
        <section className="link-box"><div className="link-heading"><div><b>관련 장비</b><span>선택 사항 · 장비와 관련 없는 일반 업무는 비워두세요.</span></div><span className="optional">선택</span></div><div className="equipment-picks">{items.map(item => <button key={item.id} className={linked.includes(item.id) ? 'selected' : ''} onClick={() => setLinked(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])}><i>{linked.includes(item.id) ? '✓' : ''}</i><span><b>{item.no} · {item.name}</b><small>{item.location} / {item.category}</small></span></button>)}</div><div className="linked-result">연결된 장비: {linked.length ? linked.map(id => items.find(x => x.id === id)?.name).join(', ') : '없음 (일반 업무로 저장)'}</div></section>
        <section className="photo-upload"><span>▧</span><div><b>공사사진·작업 전후 사진</b><small>사진을 끌어 놓거나 클릭하여 추가</small></div><button>사진 선택</button></section><footer className="form-footer"><button>취소</button><button className="primary">업무 기록 저장</button></footer></section>
    </main>}

    {editor && <div className="modal-backdrop" onMouseDown={() => setEditor(null)}><section className="editor" onMouseDown={e => e.stopPropagation()}><header><div><h2>{editor.id ? '장비 정보 수정' : '새 장비 추가'}</h2><p>이력카드의 기준이 되는 장비 기본정보입니다.</p></div><button onClick={() => setEditor(null)}>×</button></header><div className="editor-grid">{[
      ['관리번호 *', 'no'], ['설비명 *', 'name'], ['구분', 'category'], ['형식', 'model'], ['사양', 'spec'], ['단위', 'unit'], ['수량', 'qty', 'number'], ['동력', 'power'], ['설치일자', 'installed', 'month'], ['납품회사', 'vendor'], ['설치 위치', 'location'], ['부속설비', 'accessory']
    ].map(([label, key, type]) => <label key={key}><span>{label}</span><input type={type || 'text'} value={editor[key]} onChange={e => setEditor(prev => ({ ...prev, [key]: e.target.value }))} /></label>)}<label><span>상태</span><select value={editor.status} onChange={e => setEditor(prev => ({ ...prev, status: e.target.value }))}><option>사용 중</option><option>점검 필요</option><option>수리 중</option><option>폐기</option></select></label><button className="editor-photo"><span>▧</span><b>대표사진 선택</b><small>JPG, PNG</small></button></div><footer><span>* 프로토타입에서는 새로고침하면 입력값이 초기화됩니다.</span><div><button onClick={() => setEditor(null)}>취소</button><button className="primary" disabled={!editor.no.trim() || !editor.name.trim()} onClick={saveDraft}>저장</button></div></footer></section></div>}
  </div>;
}

function Summary({ label, value, tone }) { return <div className={`summary ${tone}`}><span>{label}</span><b>{value}</b></div>; }

createRoot(document.getElementById('root')).render(<App />);
