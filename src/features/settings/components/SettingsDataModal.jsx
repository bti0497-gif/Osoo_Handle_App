export default function SettingsDataModal({ isOpen, data, onClose }) {
  if (!isOpen || !data || !Array.isArray(data)) return null;

  // 전체 데이터의 키를 중복 없이 모으기 (날짜 제외)
  const allKeys = Array.from(
    data.reduce((acc, row) => {
      Object.keys(row).forEach(key => {
        if (key !== 'date') {
          acc.add(key);
        }
      });
      return acc;
    }, new Set())
  );

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white', padding: '1.5rem', borderRadius: '16px',
        width: '90%', maxWidth: '800px', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 900 }}>저장된 데이터 확인</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
            <span className="material-icons">close</span>
          </button>
        </div>
        <div style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          border: '1px solid #e2e8f0',
          borderRadius: '8px'
        }}>
          <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead style={{ backgroundColor: '#f8fafc', position: 'sticky', top: 0 }}>
              <tr>
                <th style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', textAlign: 'left', minWidth: '100px' }}>날짜</th>
                {allKeys.map(key => (
                  <th key={key} style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right', minWidth: '80px' }}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px', fontWeight: 700 }}>{row.date}</td>
                  {allKeys.map(key => (
                    <td key={key} style={{ padding: '10px', textAlign: 'right' }}>
                      {row[key] !== undefined ? row[key] : '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: '1rem', width: '100%', height: '40px', backgroundColor: '#1e293b',
            color: 'white', border: 'none', borderRadius: '8px', fontWeight: 900, cursor: 'pointer'
          }}
        >
          확인 완료
        </button>
      </div>
    </div>
  );
}
