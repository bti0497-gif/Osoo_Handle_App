export default function SettingsDataModal({ isOpen, data, onClose }) {
  if (!isOpen || !data) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white', padding: '1.5rem', borderRadius: '16px', width: '600px', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 900 }}>저장된 데이터 확인</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
            <span className="material-icons">close</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead style={{ backgroundColor: '#f8fafc', position: 'sticky', top: 0 }}>
              <tr>
                <th style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>날짜</th>
                {Object.keys(data[0] || {}).filter(k => k !== 'date').map(key => (
                  <th key={key} style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px', fontWeight: 700 }}>{row.date}</td>
                  {Object.entries(row).filter(([k]) => k !== 'date').map(([k, v]) => (
                    <td key={k} style={{ padding: '10px', textAlign: 'right' }}>{v}</td>
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
