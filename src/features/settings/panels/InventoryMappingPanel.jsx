import React from 'react';
import ExcelCellMapper from '../widgets/ExcelCellMapper';
import MappingPreviewTable from '../widgets/MappingPreviewTable';

const SUFFIXES = ['purchase', 'usage', 'inventory'];
const SUFFIX_LABELS = { purchase: '구매', usage: '사용', inventory: '재고' };
const SUFFIX_COLORS = { purchase: '#3b82f6', usage: '#f59e0b', inventory: '#8b5cf6' };

export default function InventoryMappingPanel({
  title,
  itemLabel,
  emptyIcon,
  emptyMessage,
  saveIcon,
  saveLabel,
  confirmMessage,
  incompleteMessage,
  items,
  config,
  setConfig,
  mapping,
  setMapping,
  excelSheets,
  sampleRowData,
  alphabet,
  isMetadataLoading,
  isPreviewLoading,
  importedData,
  setShowDataModal,
  showAlert,
  showConfirm,
  onSave,
}) {
  const activeItems = items.filter(i => i.checked);
  const rows = [
    { key: '__date__', label: '날짜 (Date)', isDate: true },
    ...activeItems.flatMap(item => SUFFIXES.map(s => ({
      key: `${item.name}_${s}`,
      label: `${item.name}`,
      suffix: SUFFIX_LABELS[s],
      suffixColor: SUFFIX_COLORS[s],
      itemName: item.name,
      isDate: false,
      isFirstOfGroup: s === 'purchase'
    })))
  ];

  const allMapped = rows.every(r => {
    if (r.isDate) return !!config.dateCol;
    return !!mapping[r.key];
  });

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <ExcelCellMapper
        config={config}
        setConfig={setConfig}
        excelSheets={excelSheets}
        isMetadataLoading={isMetadataLoading}
      />

      {!config.sheet ? (
        <div style={{ padding: '3rem 0', textAlign: 'center', backgroundColor: '#fcfcfc', border: '1.5px dashed #e2e8f0', borderRadius: '12px' }}>
          <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '10px' }}>{emptyIcon}</span>
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 600 }}>{emptyMessage}</p>
        </div>
      ) : (
        <MappingPreviewTable
          gridTemplateColumns="120px 50px 140px 1fr"
          headers={[itemLabel, '', '엑셀칼럼 선택', '프리뷰']}
          isPreviewLoading={isPreviewLoading}
        >

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {(() => {
              const dateCol = config.dateCol;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', padding: '8px 12px', backgroundColor: '#f0f9ff', borderRadius: '8px', alignItems: 'center', border: '1px solid #bae6fd', marginBottom: '8px', columnGap: '8px' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#334155', textAlign: 'center' }}>날짜 (Date)</span>
                  <span></span>
                  <select value={dateCol || 'A'} onChange={(e) => setConfig({ ...config, dateCol: e.target.value })}
                    style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                    <option value="">선택...</option>
                    {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                  </select>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: dateCol ? '#059669' : '#94a3b8', backgroundColor: dateCol ? '#f0fdf4' : '#f1f5f9', padding: '6px 10px', borderRadius: '6px', width: 'fit-content', minWidth: '100px', textAlign: 'center' }}>
                    {(dateCol && sampleRowData[dateCol]) || '-- No Data --'}
                  </span>
                </div>
              );
            })()}
            {activeItems.map((item, itemIdx) => {
              const groupRows = rows.filter(r => !r.isDate && r.itemName === item.name);
              return (
                <div key={item.name} style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', columnGap: '8px', borderBottom: itemIdx < activeItems.length - 1 ? '1px solid #e2e8f0' : 'none', paddingBottom: itemIdx < activeItems.length - 1 ? '6px' : 0, marginBottom: itemIdx < activeItems.length - 1 ? '6px' : 0, padding: '0 12px' }}>
                  <div style={{ gridColumn: '1 / 2', gridRow: `1 / ${groupRows.length + 1}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#1e293b' }}>{item.name}</span>
                  </div>
                  {groupRows.map((row, rIdx) => {
                    const colKey = mapping[row.key] || '';
                    const hasCol = !!colKey;
                    return (
                      <React.Fragment key={row.key}>
                        <div style={{ gridColumn: '2 / 3', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 0' }}>
                          <span style={{ fontSize: '0.625rem', fontWeight: 800, color: 'white', backgroundColor: row.suffixColor, padding: '2px 8px', borderRadius: '4px', textAlign: 'center' }}>{row.suffix}</span>
                        </div>
                        <div style={{ gridColumn: '3 / 4', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                          <select value={colKey} onChange={(e) => setMapping({ ...mapping, [row.key]: e.target.value })}
                            style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                            <option value="">선택...</option>
                            {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                          </select>
                        </div>
                        <div style={{ gridColumn: '4 / 5', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: hasCol ? '#059669' : '#94a3b8', backgroundColor: hasCol ? '#f0fdf4' : '#f1f5f9', padding: '6px 10px', borderRadius: '6px', minWidth: '100px', textAlign: 'center' }}>
                            {(hasCol && sampleRowData[colKey]) || '-- No Data --'}
                          </span>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </MappingPreviewTable>
      )}

      {config.sheet && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', gap: '0.75rem' }}>
          <button onClick={() => setShowDataModal(true)} disabled={!importedData}
            style={{
              width: '160px', height: '50px', backgroundColor: importedData ? '#f1f5f9' : '#f8fafc', color: importedData ? '#1e293b' : '#cbd5e1',
              border: '1.5px solid #cbd5e1', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
              cursor: importedData ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}>
            <span className="material-icons">visibility</span>저장된 데이타보기
          </button>
          <button
            onClick={async () => {
              if (!allMapped) {
                await showAlert(incompleteMessage);
                return;
              }
              const confirmed = await showConfirm(confirmMessage);
              if (confirmed) onSave();
            }}
            disabled={!allMapped}
            style={{
              width: '240px', height: '50px', backgroundColor: allMapped ? '#1e293b' : '#cbd5e1', color: 'white',
              border: 'none', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
              cursor: allMapped ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}>
            <span className="material-icons">{saveIcon}</span>{saveLabel}
          </button>
        </div>
      )}
    </div>
  );
}
