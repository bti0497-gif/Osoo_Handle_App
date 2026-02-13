import React from 'react';

const Header = () => {
    return (
        <header className="app-header">
            <div className="titlebar-left" style={{ flex: 1, minWidth: 0 }}>
                <div className="app-icon-container" style={{ flexShrink: 0 }}>
                    <span className="app-icon" style={{ fontSize: '1rem' }}>🏭</span>
                </div>
                <h1 className="app-name" style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    전국휴게소 오수처리장 통합관리시스템
                </h1>
            </div>

            <div className="titlebar-right" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <div className="window-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="material-icons control-btn" title="최소화">minimize</span>
                    <span className="material-icons control-btn" title="최대화">check_box_outline_blank</span>
                    <span className="material-icons control-btn close" title="닫기">close</span>
                </div>
            </div>
        </header>
    );
};

export default Header;
