export default function SettingsImportProgress({ importProgress, onClose }) {
  if (!importProgress?.isVisible) return null;

  const progressPercent = Math.min(
    100,
    Math.round((importProgress.current / importProgress.total) * 100)
  ) || 0;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white', padding: '2rem', borderRadius: '16px', width: '300px',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', textAlign: 'center'
      }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: '1rem' }}>
          {importProgress.status === 'completed' ? '저장 완료!' :
            importProgress.status === 'error' ? '오류 발생' : '데이터 저장 중...'}
        </h3>
        <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
          <div style={{
            width: `${progressPercent}%`, height: '100%', backgroundColor: '#1e293b',
            transition: 'width 0.3s ease-out'
          }} />
        </div>
        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
          {importProgress.status === 'completed' ? `${importProgress.total}개의 행을 모두 저장했습니다.` :
            importProgress.status === 'error' ? importProgress.result :
              `총 ${importProgress.total}행 중 ${importProgress.current}행 처리 중 (${progressPercent}%)`}
        </p>
        {(importProgress.status === 'completed' || importProgress.status === 'error') && (
          <button
            onClick={onClose}
            style={{
              marginTop: '1.5rem', width: '100%', height: '40px', backgroundColor: '#1e293b',
              color: 'white', border: 'none', borderRadius: '8px', fontWeight: 900, cursor: 'pointer'
            }}
          >
            닫기
          </button>
        )}
      </div>
    </div>
  );
}
