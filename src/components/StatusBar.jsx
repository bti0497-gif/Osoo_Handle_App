import React, { useState, useEffect } from 'react';

const StatusBar = ({ title, helpText, locationStatus = { status: 'idle', message: '' } }) => {
    const [time, setTime] = useState(new Date().toLocaleTimeString());
    const [updateState, setUpdateState] = useState({
        status: 'idle',
        label: '새 버전 확인',
        detail: '',
        percent: 0,
    });

    useEffect(() => {
        const timer = setInterval(() => {
            setTime(new Date().toLocaleTimeString());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api) return undefined;

        api.onUpdateChecking?.(() => {
            setUpdateState({ status: 'checking', label: '확인 중', detail: '', percent: 0 });
        });
        api.onUpdateAvailable?.((info) => {
            setUpdateState({
                status: 'available',
                label: '다운로드 중',
                detail: info?.version ? `v${info.version}` : '',
                percent: 0,
            });
        });
        api.onUpdateNotAvailable?.(() => {
            setUpdateState({ status: 'idle', label: '새 버전 확인', detail: '현재 최신 버전입니다.', percent: 0 });
        });
        api.onUpdateProgress?.((progress) => {
            const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
            setUpdateState({
                status: 'downloading',
                label: `다운로드 ${percent}%`,
                detail: '',
                percent,
            });
        });
        api.onUpdateDownloaded?.((info) => {
            setUpdateState({
                status: 'downloaded',
                label: '새 버전 확인됨',
                detail: info?.version ? `v${info.version} · 업데이트가 준비되었습니다.` : '업데이트가 준비되었습니다.',
                percent: 100,
            });
        });
        api.onUpdateInstalling?.(() => {
            setUpdateState({ status: 'installing', label: '설치 중', detail: '재시작 예정', percent: 100 });
        });
        api.onUpdateError?.((message) => {
            setUpdateState({
                status: 'error',
                label: '업데이트 오류',
                detail: String(message || '').slice(0, 32),
                percent: 0,
            });
        });

        return undefined;
    }, []);

    const handleUpdateClick = async () => {
        const api = window.electronAPI;
        if (!api) return;
        if (updateState.status === 'downloaded') {
            await api.installUpdate?.();
            return;
        }
        if (['checking', 'available', 'downloading', 'installing'].includes(updateState.status)) return;

        setUpdateState({ status: 'checking', label: '새 버전 확인 중', detail: '', percent: 0 });
        try {
            await api.checkForUpdates?.('status-bar');
        } catch (error) {
            setUpdateState({
                status: 'error',
                label: '업데이트 확인 실패',
                detail: String(error?.message || error || '').slice(0, 80),
                percent: 0,
            });
        }
    };

    const updateIcon = updateState.status === 'downloaded'
        ? 'system_update_alt'
        : updateState.status === 'error'
            ? 'error'
            : 'system_update';

    const locationIcon = locationStatus.status === 'checking'
        ? 'my_location'
        : locationStatus.status === 'success'
            ? 'location_on'
            : locationStatus.status === 'error'
                ? 'location_off'
                : 'location_searching';
    const locationColor = locationStatus.status === 'success'
        ? '#4ade80'
        : locationStatus.status === 'checking'
            ? '#60a5fa'
            : '#fbbf24';

    return (
        <footer className="status-bar">
            <div className="status-left">
                <div className="status-item">
                    <span className="material-icons text-primary" style={{ fontSize: '14px' }}>navigation</span>
                    <span>현재 메뉴: <span className="current-menu-highlight">{title}</span></span>
                </div>
                <div className="status-item" style={{ borderLeft: '1px solid #475569', paddingLeft: '1rem' }}>
                    <span className="material-icons text-green-400" style={{ fontSize: '14px' }}>info</span>
                    <span>도움말: {helpText || '각 항목의 상세 데이터는 왼쪽 메뉴를 통해 접근하세요.'}</span>
                </div>
            </div>

            <div className="status-right">
                {locationStatus.status !== 'idle' ? (
                    <div className="status-item" title={locationStatus.message}>
                        <span className="material-icons" style={{ fontSize: '14px', color: locationColor }}>{locationIcon}</span>
                        <span style={{ color: locationColor }}>{locationStatus.message}</span>
                    </div>
                ) : null}
                <button
                    type="button"
                    className={`status-update-button status-update-${updateState.status}`}
                    title={updateState.detail || updateState.label}
                    aria-label={updateState.detail || updateState.label}
                    onClick={handleUpdateClick}
                    disabled={['checking', 'available', 'downloading', 'installing'].includes(updateState.status)}
                >
                    <span className="material-icons" style={{ fontSize: '14px' }}>{updateIcon}</span>
                    <span>{updateState.label}</span>
                    {updateState.detail ? <span className="status-update-detail">{updateState.detail}</span> : null}
                </button>
                <div className="status-item">
                    <span className="material-icons" style={{ fontSize: '14px', color: '#94a3b8' }}>login</span>
                    <span>현재 시간: <span style={{ color: 'white' }}>{time}</span></span>
                </div>
                <div className="status-item" style={{ backgroundColor: '#334155', padding: '2px 8px', borderRadius: '4px', color: 'white' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', marginRight: '6px' }}></div>
                    <span>서버 상태: 양호</span>
                </div>
            </div>
        </footer>
    );
};

export default StatusBar;
