import React, { useRef } from 'react';
import { useMedicineInViewModel } from './useMedicineInViewModel';

const panel = {
  display: 'flex',
  width: '100%',
  height: '100%',
  backgroundColor: '#ffffff',
  padding: '1.25rem',
  gap: '1.25rem',
};

const leftPanel = {
  width: '300px',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  overflowY: 'auto',
};

const rightPanel = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  overflow: 'hidden',
};

const card = {
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  backgroundColor: '#fff',
  padding: '14px 16px',
  boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
};

const selectStyle = {
  padding: '5px 8px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  color: '#1e293b',
  backgroundColor: '#fff',
  cursor: 'pointer',
};

const inputStyle = {
  padding: '5px 8px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  color: '#1e293b',
  width: '72px',
  textAlign: 'right',
};

const dateInputStyle = {
  padding: '5px 8px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  color: '#1e293b',
  flex: 1,
};

const tableCell = {
  border: '1px solid #0f172a',
  padding: '4px',
  height: '22px',
  fontSize: '12px',
  color: '#0f172a',
};

const tableHeaderCell = {
  ...tableCell,
  backgroundColor: '#f1f5f9',
  fontWeight: 800,
};

const previewCell = (width, height, bg = '#f8fafc') => ({
  width,
  height,
  backgroundColor: bg,
  border: '1px dashed #cbd5e1',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
});

const PhotoButton = React.memo(({ onFile, hasPhoto }) => {
  const ref = useRef(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
            event.target.value = '';
          }
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        title="사진 선택"
        style={{
          padding: '4px 8px',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: 700,
          border: `1px solid ${hasPhoto ? '#4ade80' : '#cbd5e1'}`,
          backgroundColor: hasPhoto ? '#f0fdf4' : '#f8fafc',
          color: hasPhoto ? '#16a34a' : '#64748b',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {hasPhoto ? '사진 있음' : '사진'}
      </button>
    </>
  );
});

const PreviewImg = ({ url, width, height, label }) => (
  <div style={previewCell(width, height, '#fff')}>
    {url ? (
      <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    ) : (
      <span style={{ fontSize: '10px', color: '#94a3b8' }}>{label}</span>
    )}
  </div>
);

export default function MedicineInView({ currentUser }) {
  const vm = useMedicineInViewModel(currentUser);
  const {
    year,
    setYear,
    month,
    setMonth,
    tab,
    setTab,
    medicineDate,
    setMedicineDate,
    kitDate,
    setKitDate,
    siteName,
    medicineItems,
    kitItems,
    tradePhotoFile,
    tradePreviewUrl,
    isLoading,
    isSaving,
    isExporting,
    yearOptions,
    monthOptions,
    updateMedicinePurchase,
    updateMedicinePhoto,
    updateKitPurchase,
    updateKitPhoto,
    updateTradePhoto,
    handleSave,
    handleExport,
  } = vm;

  const mm = String(month).padStart(2, '0');
  const baseNames = ['중탄산나트륨', '포도당', '팩(PAC)'];
  const baseMeds = medicineItems.filter((item) => baseNames.includes(item.name));
  const extraMeds = medicineItems.filter((item) => !baseNames.includes(item.name));

  const tabButtonStyle = (active) => ({
    flex: 1,
    padding: '8px 0',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 800,
    cursor: 'pointer',
    backgroundColor: active ? '#0f172a' : '#f1f5f9',
    color: active ? '#fff' : '#64748b',
  });

  const actionButton = (label, onClick, disabled) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 0',
        borderRadius: '8px',
        border: 'none',
        fontSize: '13px',
        fontWeight: 800,
        backgroundColor: !disabled ? '#0f172a' : '#e2e8f0',
        color: !disabled ? '#fff' : '#94a3b8',
        cursor: !disabled ? 'pointer' : 'not-allowed',
        width: '100%',
      }}
    >
      {label}
    </button>
  );

  const renderMedicineLeft = () => (
    <>
      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, marginBottom: 6 }}>입고 날짜</div>
        <input type="date" value={medicineDate} onChange={(e) => setMedicineDate(e.target.value)} style={{ ...dateInputStyle, width: '100%' }} />
      </div>

      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, marginBottom: 10 }}>약품 입고량 (kg)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {medicineItems.map((item) => (
            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              <input type="number" min={0} value={item.purchase} onChange={(e) => updateMedicinePurchase(item.name, e.target.value)} style={inputStyle} />
              <PhotoButton hasPhoto={!!(item.photoFile || item.previewUrl)} onFile={(file) => updateMedicinePhoto(item.name, file)} />
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, marginBottom: 8 }}>거래명세서</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#334155', flex: 1 }}>사진</span>
          <PhotoButton hasPhoto={!!(tradePhotoFile || tradePreviewUrl)} onFile={updateTradePhoto} />
        </div>
      </div>
    </>
  );

  const renderKitLeft = () => (
    <>
      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, marginBottom: 6 }}>입고 날짜</div>
        <input type="date" value={kitDate} onChange={(e) => setKitDate(e.target.value)} style={{ ...dateInputStyle, width: '100%' }} />
      </div>

      <div style={card}>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, marginBottom: 10 }}>키트 입고량 (개)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {kitItems.map((item) => (
            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              <input type="number" min={0} value={item.purchase} onChange={(e) => updateKitPurchase(item.name, e.target.value)} style={inputStyle} />
              <PhotoButton hasPhoto={!!(item.photoFile || item.previewUrl)} onFile={(file) => updateKitPhoto(item.name, file)} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: '10px', color: '#94a3b8' }}>
          사진은 최대 2장까지 출력됩니다. (키트1, 키트2)
        </div>
      </div>
    </>
  );

  const renderMedicinePreview = () => {
    const displayDate = medicineDate ? medicineDate.replace(/-/g, '.') : `${year}.${mm}`;
    const allMeds = [...baseMeds, ...extraMeds.slice(0, 2)];

    return (
      <div style={{ fontFamily: '"Malgun Gothic", sans-serif', fontSize: '13px', paddingBottom: 16 }}>
        <h3 style={{ textAlign: 'center', fontWeight: 800, fontSize: '14px', letterSpacing: 0, marginBottom: 12 }}>
          ({mm}월) 약품입고 사진대지
        </h3>
        <table style={{ width: '446px', borderCollapse: 'collapse', tableLayout: 'fixed', margin: '0 auto' }}>
          <colgroup>
            <col style={{ width: '90px' }} />
            <col style={{ width: '56px' }} />
            <col style={{ width: '300px' }} />
          </colgroup>
          <thead>
            <tr>
              <td style={{ ...tableHeaderCell, textAlign: 'center' }}>{displayDate}</td>
              <td colSpan={2} style={{ ...tableHeaderCell, textAlign: 'center' }}>사진대지</td>
            </tr>
          </thead>
          <tbody>
            {allMeds.map((item, idx) => (
              <tr key={item.name}>
                <td style={{ ...tableCell, fontWeight: 700, textAlign: 'center' }}>{item.name}</td>
                <td style={{ ...tableCell, textAlign: 'center', color: '#475569' }}>{item.purchase || 0}</td>
                <td style={{ ...tableCell, padding: '4px 6px' }}>
                  <PreviewImg url={item.previewUrl} width="100%" height={80} label={`약품${idx + 1} 사진`} />
                </td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 2 - extraMeds.length) }).map((_, index) => (
              <tr key={`empty_extra_${index}`}>
                <td style={{ ...tableCell, color: '#cbd5e1', textAlign: 'center' }}>(추가 약품)</td>
                <td style={tableCell} />
                <td style={{ ...tableCell, padding: '4px 6px' }}>
                  <div style={{ ...previewCell('100%', 80), color: '#cbd5e1', fontSize: '10px' }}>빈 칸</div>
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ ...tableCell, fontWeight: 700, textAlign: 'center' }}>거래명세서</td>
              <td style={tableCell} />
              <td style={{ ...tableCell, padding: '4px 6px' }}>
                <PreviewImg url={tradePreviewUrl} width="100%" height={91} label="거래명세서 사진" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  const renderKitPreview = () => {
    const kitPhotos = kitItems.slice(0, 2);
    return (
      <div style={{ fontFamily: '"Malgun Gothic", sans-serif', fontSize: '13px', paddingBottom: 16 }}>
        <h3 style={{ textAlign: 'center', fontWeight: 800, fontSize: '14px', letterSpacing: 0, marginBottom: 16 }}>
          ({mm}월) 수질분석 키트 입고 사진대지
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
          {kitPhotos.map((item, idx) => (
            <div key={item.name} style={{ width: '100%', maxWidth: 500 }}>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: 4, textAlign: 'left' }}>
                {item.name} ({item.purchase || 0}개)
              </div>
              <PreviewImg url={item.previewUrl} width="100%" height={132} label={`키트${idx + 1} 사진`} />
            </div>
          ))}
          {Array.from({ length: Math.max(0, 2 - kitPhotos.length) }).map((_, index) => (
            <div key={`empty_kit_${index}`} style={{ width: '100%', maxWidth: 500 }}>
              <div style={{ ...previewCell('100%', 132), color: '#cbd5e1', fontSize: '11px' }}>
                키트{kitPhotos.length + index + 1} 사진
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={panel}>
      <div style={leftPanel}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#1e293b', letterSpacing: 0, margin: 0, flexShrink: 0 }}>
          약품입고일지
        </h1>

        <div style={{ ...card, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#475569' }}>
              연도
              <select style={selectStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions.map((optionYear) => <option key={optionYear} value={optionYear}>{optionYear}년</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#475569' }}>
              월
              <select style={selectStyle} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {monthOptions.map((optionMonth) => <option key={optionMonth} value={optionMonth}>{optionMonth}월</option>)}
              </select>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button type="button" style={tabButtonStyle(tab === 'medicine')} onClick={() => setTab('medicine')}>약품</button>
          <button type="button" style={tabButtonStyle(tab === 'kit')} onClick={() => setTab('kit')}>키트</button>
        </div>

        {isLoading ? (
          <div style={{ fontSize: '13px', color: '#94a3b8', padding: '20px 0', textAlign: 'center' }}>
            불러오는 중...
          </div>
        ) : tab === 'medicine' ? renderMedicineLeft() : renderKitLeft()}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, marginTop: 'auto' }}>
          {actionButton(
            isSaving ? '저장 중...' : `${tab === 'medicine' ? '약품' : '키트'} 입고일지 저장`,
            handleSave,
            isSaving || isExporting || isLoading
          )}
          <p style={{ fontSize: '10px', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
            저장하면 로컬 DB와 사진 폴더에 먼저 반영되고, 백그라운드 동기화가 실행됩니다.
          </p>
        </div>
      </div>

      <div style={rightPanel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <p style={{ fontSize: '13px', color: '#475569', margin: 0, flexShrink: 0 }}>
            <span style={{ color: '#94a3b8', marginRight: 4 }}>현장명</span>
            <strong style={{ color: '#0f172a', marginRight: 16 }}>{siteName || '-'}</strong>
            <span style={{ color: '#94a3b8', marginRight: 4 }}>대상</span>
            <strong style={{ color: '#0f172a' }}>{year}년 {mm}월</strong>
          </p>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || isSaving || isLoading}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '12px',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              backgroundColor: (!isExporting && !isSaving && !isLoading) ? '#0f172a' : '#e2e8f0',
              color: (!isExporting && !isSaving && !isLoading) ? '#fff' : '#94a3b8',
              cursor: (!isExporting && !isSaving && !isLoading) ? 'pointer' : 'not-allowed',
            }}
          >
            {isExporting ? '출력 중...' : '약품입고일지 출력'}
          </button>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '18px',
        }}>
          <div style={{
            width: '540px',
            minHeight: '760px',
            background: '#fff',
            margin: '0 auto',
            padding: '28px',
            boxShadow: '0 4px 16px rgba(15,23,42,0.08)',
          }}>
            {tab === 'medicine' ? renderMedicinePreview() : renderKitPreview()}
          </div>
        </div>
      </div>
    </div>
  );
}
