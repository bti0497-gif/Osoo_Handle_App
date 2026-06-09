import React from 'react';
import SettingsDataModal from './SettingsDataModal';
import SettingsImportProgress from './SettingsImportProgress';
import SettingsTabs from './SettingsTabs';

export default function SettingsShell({
    isLoading,
    activeTab,
    setActiveTab,
    isAppSiteConfigured,
    importProgress,
    setImportProgress,
    showDataModal,
    importedData,
    setShowDataModal,
    children,
}) {
    return (
        <div
            className="panel-container"
            style={{
                padding: 0,
                gap: 0,
                overflow: 'hidden',
                alignItems: 'stretch',
            }}
        >
            {isLoading ? (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        minWidth: 0,
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'white',
                    }}
                >
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
                </div>
            ) : (
                <div
                    className="dynamic-panel border-slate-200"
                    style={{
                        width: '100%',
                        height: '100%',
                        minWidth: 0,
                        minHeight: 0,
                        flexShrink: 1,
                        borderRadius: 0,
                        border: 'none',
                        boxShadow: 'none',
                    }}
                >
                    <SettingsTabs
                        activeTab={activeTab}
                        setActiveTab={setActiveTab}
                        isAppSiteConfigured={isAppSiteConfigured}
                    />
                    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
                        {children}
                    </div>
                    <SettingsImportProgress
                        importProgress={importProgress}
                        onClose={() => setImportProgress(prev => ({ ...prev, isVisible: false }))}
                    />
                    <SettingsDataModal
                        isOpen={showDataModal}
                        data={importedData}
                        onClose={() => setShowDataModal(false)}
                    />
                </div>
            )}
        </div>
    );
}
