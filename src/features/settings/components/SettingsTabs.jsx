const SETTINGS_TABS = [
  { id: 'basic', label: '기본설정' },
  { id: 'flow', label: '유량설정' },
  { id: 'medicine', label: '약품설정' },
  { id: 'water', label: '수질설정' },
  { id: 'kit', label: '키트설정' },
  { id: 'logMapping', label: '일지설정' },
  { id: 'webapp', label: '웹/앱설정' },
];

export default function SettingsTabs({ activeTab, setActiveTab, isAppSiteConfigured }) {
  return (
    <div style={{
      display: 'flex',
      borderBottom: '2px solid #f1f5f9',
      backgroundColor: '#fff',
      flexShrink: 0,
      borderRadius: '20px 20px 0 0',
      position: 'sticky',
      top: 0,
      zIndex: 10
    }}>
      {SETTINGS_TABS.map((tab) => {
        const isLockedTab = tab.id !== 'basic' && !isAppSiteConfigured;
        return (
          <button
            key={tab.id}
            onClick={() => {
              if (isLockedTab) return;
              setActiveTab(tab.id);
            }}
            disabled={isLockedTab}
            title={isLockedTab ? '기본설정에서 현장 선택 후 저장하면 활성화됩니다.' : ''}
            style={{
              flex: 1,
              height: '56px',
              border: 'none',
              background: 'none',
              fontSize: '0.875rem',
              fontWeight: activeTab === tab.id ? 900 : 700,
              color: isLockedTab ? '#cbd5e1' : (activeTab === tab.id ? '#1e293b' : '#94a3b8'),
              borderBottom: activeTab === tab.id ? '2.5px solid #1e293b' : '2.5px solid transparent',
              cursor: isLockedTab ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
