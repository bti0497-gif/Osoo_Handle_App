import React from 'react';

const Header = () => {
    return (
        <header className="app-header desktop-titlebar">
            <div className="titlebar-left drag-region">
                <span className="app-icon">🏭</span>
                <span className="app-name">전국 오수처리장 통합관리시스템</span>
            </div>

            <div className="titlebar-right">
                <div className="window-controls">
                    <button className="control-btn minimize" title="최소화">➖</button>
                    <button className="control-btn maximize" title="최대화">◻</button>
                    <button className="control-btn close" title="닫기">❌</button>
                </div>
            </div>
        </header>
    );
};

export default Header;
