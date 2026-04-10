import React, { useRef, useCallback } from 'react';
import { useMedicineInViewModel } from './useMedicineInViewModel';

/* ─── 스타일 상수 ────────────────────────────────────── */
const panel = {
  display: 'flex', width: '100%', height: '100%',
  backgroundColor: '#ffffff', padding: '1.25rem', gap: '1.25rem',
};
const leftPanel = {
  width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem',
  overflowY: 'auto',
};
const rightPanel = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem',
  overflow: 'hidden',
};
const card = {
  border: '1px solid #e2e8f0', borderRadius: '12px',
  backgroundColor: '#fff', padding: '14px 16px',
  boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
};
const sel = {
  padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1',
  fontSize: '13px', color: '#1e293b', backgroundColor: '#fff', cursor: 'pointer',
};
const inp = {
  padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1',
  fontSize: '13px', color: '#1e293b', width: '72px', textAlign: 'right',
};
const dateInp = {
  padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1',
  fontSize: '13px', color: '#1e293b', flex: 1,
};

/* 미리보기 셀 공통 */
const previewCell = (w, h, bg = '#f8fafc') => ({
  width: w, height: h, backgroundColor: bg,
  border: '1px dashed #cbd5e1', borderRadius: '4px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  overflow: 'hidden', flexShrink: 0,
});

/* ─── 사진 선택 버튼 ─────────────────────────────────── */
const PhotoButton = React.memo(({ onFile, hasPhoto }) => {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = ''; } }} />
      <button
        onClick={() => ref.current?.click()}
        title="사진 선택"
        style={{
          padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
          border: `1px solid ${hasPhoto ? '#4ade80' : '#cbd5e1'}`,
          backgroundColor: hasPhoto ? '#f0fdf4' : '#f8fafc',
          color: hasPhoto ? '#16a34a' : '#64748b',
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        {hasPhoto ? '✓ 사진' : '📷 사진'}
      </button>
    </>
  );
});

/* ─── 미리보기 이미지 셀 ─────────────────────────────── */
const PreviewImg = ({ url, width, height, label }) => (
  <div style={previewCell(width, height, '#fff')}>
    {url
      ? <img src={url} alt={label} style={{ width: '100%', height: '100%' }} />
      : <span style={{ fontSize: '10px', color: '#94a3b8' }}>{label}</span>}
  </div>
);

/* ─── 메인 컴포넌트 ──────────────────────────────────── */
export default function MedicineInView() {
  const vm = useMedicineInViewModel();
  const {
    year, setYear, month, setMonth, tab, setTab,
    medicineDate, setMedicineDate, kitDate, setKitDate,
    siteName, medicineItems, kitItems, tradePhotoFile, tradePreviewUrl,
    isLoading, isSaving, isExporting,
    yearOptions, monthOptions,
    updateMedicinePurchase, updateMedicinePhoto,
    updateKitPurchase, updateKitPhoto,
    updateTradePhoto, handleSave, handleExport,
  } = vm;

  const mm = String(month).padStart(2, '0');
  const BASE_NAMES = ['포도당', '중탄산나트륨', '팩(PAC)'];
  const baseMeds = medicineItems.filter(i => BASE_NAMES.includes(i.name));
  const extraMeds = medicineItems.filter(i => !BASE_NAMES.includes(i.name));

  /* ── 탭 버튼 스타일 ── */
  const tabBtn = (active) => ({
    flex: 1, padding: '8px 0', border: 'none', borderRadius: '8px', fontSize: '13px',
    fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
    backgroundColor: active ? '#0f172a' : '#f1f5f9',
    color: active ? '#fff' : '#64748b',
  });

  /* ── 행 버튼 ── */
  const rowBtn = (label, onClick, disabled) => (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: '7px 0', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 600,
        backgroundColor: !disabled ? '#0f172a' : '#e2e8f0',
        color: !disabled ? '#fff' : '#94a3b8', cursor: !disabled ? 'pointer' : 'not-allowed',
        width: '100%', transition: 'background-color 0.15s',
      }}>
      {label}
    </button>
  );

  /* ── 약품 탭 왼쪽 패널 ── */
  const renderMedicineLeft = () => (
    <>
      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: 6 }}>입고 날짜</div>
        <input type="date" value={medicineDate} onChange={e => setMedicineDate(e.target.value)}
          style={{ ...dateInp, width: '100%' }} />
      </div>

      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: 10 }}>약품 입고량 (kg)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {medicineItems.map(item => (
            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#334155', flex: 1, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
              <input type="number" min={0} value={item.purchase}
                onChange={e => updateMedicinePurchase(item.name, e.target.value)}
                style={inp} />
              <PhotoButton hasPhoto={!!(item.photoFile || item.previewUrl)}
                onFile={f => updateMedicinePhoto(item.name, f)} />
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: 8 }}>거래명세서</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#334155', flex: 1 }}>사진</span>
          <PhotoButton hasPhoto={!!(tradePhotoFile || tradePreviewUrl)} onFile={updateTradePhoto} />
        </div>
      </div>
    </>
  );

  /* ── 키트 탭 왼쪽 패널 ── */
  const renderKitLeft = () => (
    <>
      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: 6 }}>입고 날짜</div>
        <input type="date" value={kitDate} onChange={e => setKitDate(e.target.value)}
          style={{ ...dateInp, width: '100%' }} />
      </div>

      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: 10 }}>키트 입고량 (개)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {kitItems.map(item => (
            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#334155', flex: 1, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
              <input type="number" min={0} value={item.purchase}
                onChange={e => updateKitPurchase(item.name, e.target.value)}
                style={inp} />
              <PhotoButton hasPhoto={!!(item.photoFile || item.previewUrl)}
                onFile={f => updateKitPhoto(item.name, f)} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: '10px', color: '#94a3b8' }}>
          * 사진은 최대 2장 (키트1, 키트2)
        </div>
      </div>
    </>
  );

  /* ── 약품 미리보기 (1페이지) ── */
  const renderMedicinePreview = () => {
    // 날짜 표시
    const dispDate = medicineDate
      ? medicineDate.replace(/-/g, '.') : `${year}.${mm}.??`;

    const allMeds = [...baseMeds, ...extraMeds.slice(0, 2)];

    return (
      <div style={{ fontFamily: '"Malgun Gothic", sans-serif', fontSize: '13px', paddingBottom: 16 }}>
        <h3 style={{ textAlign: 'center', fontWeight: 800, fontSize: '14px',
          letterSpacing: '0.05em', marginBottom: 12 }}>
          ( {mm} 월 ) &nbsp; 약품입고 사진대지
        </h3>

        <table style={{ width: '446px', borderCollapse: 'collapse', tableLayout: 'fixed', margin: '0 auto' }}>
          <colgroup>
            <col style={{ width: '90px' }} />
            <col style={{ width: '56px' }} />
            <col style={{ width: '300px' }} />
          </colgroup>
          <thead>
            <tr>
              <td style={{ ...tdH, textAlign: 'center' }}>{dispDate}</td>
              <td colSpan={2} style={{ ...tdH, textAlign: 'center', letterSpacing: '0.2em' }}>
                사 진 대 지
              </td>
            </tr>
          </thead>
          <tbody>
            {allMeds.map((item, idx) => (
              <tr key={item.name}>
                <td style={{ ...td, fontWeight: 600, textAlign: 'center' }}>{item.name}</td>
                <td style={{ ...td, textAlign: 'center', color: '#475569' }}>
                  {item.purchase || 0}
                </td>
                <td style={{ ...td, padding: '4px 6px' }}>
                  <PreviewImg url={item.previewUrl} width="100%" height={80} label={`약${idx + 1}사진`} />
                </td>
              </tr>
            ))}
            {/* 추가 약품이 2개 미만이면 빈 행 */}
            {Array.from({ length: Math.max(0, 2 - extraMeds.length) }).map((_, i) => (
              <tr key={`empty_extra_${i}`}>
                <td style={{ ...td, color: '#cbd5e1', textAlign: 'center' }}>(추가약품)</td>
                <td style={td} />
                <td style={{ ...td, padding: '4px 6px' }}>
                  <div style={{ ...previewCell('100%', 80), color: '#cbd5e1', fontSize: '10px' }}>—</div>
                </td>
              </tr>
            ))}
            {/* 거래명세서 */}
            <tr>
              <td style={{ ...td, fontWeight: 600, textAlign: 'center' }}>거래명세서</td>
              <td style={td} />
              <td style={{ ...td, padding: '4px 6px' }}>
                <PreviewImg url={tradePreviewUrl} width="100%" height={91} label="거래사진" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  /* ── 키트 미리보기 (2페이지) ── */
  const renderKitPreview = () => {
    const kitPhotos = kitItems.slice(0, 2);
    return (
      <div style={{ fontFamily: '"Malgun Gothic", sans-serif', fontSize: '13px', paddingBottom: 16 }}>
        <h3 style={{ textAlign: 'center', fontWeight: 800, fontSize: '14px',
          letterSpacing: '0.05em', marginBottom: 16 }}>
          ( {mm} 월 ) &nbsp; 수질분석 키트 입고 사진대지
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
          {kitPhotos.map((item, idx) => (
            <div key={item.name} style={{ width: '100%', maxWidth: 500 }}>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: 4, textAlign: 'left' }}>
                {item.name} ({item.purchase || 0}개)
              </div>
              <PreviewImg url={item.previewUrl} width="100%" height={132} label={`키트${idx + 1}사진`} />
            </div>
          ))}
          {/* 키트가 2개 미만이면 빈 셀 */}
          {Array.from({ length: Math.max(0, 2 - kitPhotos.length) }).map((_, i) => (
            <div key={`empty_kit_${i}`} style={{ width: '100%', maxWidth: 500 }}>
              <div style={{ ...previewCell('100%', 132), color: '#cbd5e1', fontSize: '11px' }}>
                키트{kitPhotos.length + i + 1}사진
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={panel}>
      {/* ── 좌측 패널 ── */}
      <div style={leftPanel}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#1e293b',
          letterSpacing: '-0.025em', margin: 0, flexShrink: 0 }}>
          약품입고일지
        </h1>

        {/* 연도/월 선택 */}
        <div style={{ ...card, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px',
              fontSize: '13px', color: '#475569' }}>
              연도
              <select style={sel} value={year} onChange={e => setYear(Number(e.target.value))}>
                {yearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px',
              fontSize: '13px', color: '#475569' }}>
              월
              <select style={sel} value={month} onChange={e => setMonth(Number(e.target.value))}>
                {monthOptions.map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* 탭 */}
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button style={tabBtn(tab === 'medicine')} onClick={() => setTab('medicine')}>
            약품
          </button>
          <button style={tabBtn(tab === 'kit')} onClick={() => setTab('kit')}>
            키트
          </button>
        </div>

        {/* 탭 내용 */}
        {isLoading ? (
          <div style={{ fontSize: '13px', color: '#94a3b8', padding: '20px 0', textAlign: 'center' }}>
            불러오는 중...
          </div>
        ) : tab === 'medicine' ? renderMedicineLeft() : renderKitLeft()}

        {/* 저장 + 생성 버튼 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, marginTop: 'auto' }}>
          {rowBtn(
            isSaving ? '저장 중...' : `${tab === 'medicine' ? '약품' : '키트'} 입고일지 저장`,
            handleSave,
            isSaving || isExporting || isLoading,
          )}
          <button
            onClick={handleExport}
            disabled={isExporting || isSaving || isLoading}
            style={{
              padding: '10px 0', borderRadius: '8px', border: 'none', fontSize: '14px',
              fontWeight: 700, width: '100%', transition: 'background-color 0.15s',
              backgroundColor: (!isExporting && !isSaving && !isLoading) ? '#0f172a' : '#e2e8f0',
              color: (!isExporting && !isSaving && !isLoading) ? '#fff' : '#94a3b8',
              cursor: (!isExporting && !isSaving && !isLoading) ? 'pointer' : 'not-allowed',
            }}>
            {isExporting ? '생성 중...' : '약품입고일지 생성하기'}
          </button>
          <p style={{ fontSize: '10px', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
            HWPX 양식이 설정에 업로드돼 있어야 합니다. 생성하기를 누르면 약품·키트 구매량이 함께 저장됩니다.
          </p>
        </div>
      </div>

      {/* ── 우측 패널 (HTML 미리보기) ── */}
      <div style={rightPanel}>
        {siteName && (
          <p style={{ fontSize: '13px', color: '#475569', margin: 0, flexShrink: 0 }}>
            <span style={{ color: '#94a3b8', marginRight: 4 }}>현장명</span>
            <strong style={{ color: '#0f172a', marginRight: 16 }}>{siteName}</strong>
            <span style={{ color: '#94a3b8', marginRight: 4 }}>대상</span>
            <strong style={{ color: '#0f172a' }}>{year}년 {mm}월</strong>
          </p>
        )}

        <div style={{
          border: '1px solid #e2e8f0', borderRadius: '12px', backgroundColor: '#fff',
          flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px',
        }}>
          {isLoading
            ? <div style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', paddingTop: 40 }}>
                데이터 불러오는 중...
              </div>
            : tab === 'medicine' ? renderMedicinePreview() : renderKitPreview()
          }
        </div>
      </div>
    </div>
  );
}

/* ─── 테이블 셀 스타일 ─────────────────────────────── */
const tdH = {
  border: '1px solid #94a3b8', padding: '6px 8px',
  backgroundColor: '#f1f5f9', fontWeight: 600, fontSize: '12px',
};
const td = {
  border: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '12px',
  verticalAlign: 'middle',
};
