import React from 'react';

const Sidebar = ({ user, activeTab, onTabChange, onLogout, onUpdatePassword }) => {
    const menus = [
        { id: 'flow', label: '유량관리' },
        { id: 'medicine', label: '약품관리' },
        { id: 'water', label: '수질관리' },
        { id: 'facility', label: '시설관리' },
        { id: 'board', label: '소통게시판' },
    ];

    // 성(Surname) 추출 (아이콘용)
    const surname = user?.name?.charAt(0) || 'U';

    return (
        <aside className="sidebar">
            <div className="user-group">
                <div className="user-info">
                    <div className="user-avatar">{surname}</div>
                    <div className="user-details">
                        <span className="user-name">{user?.name}님</span>
                        <span className="user-role">현장 근무자</span>
                    </div>
                </div>
                <div className="user-actions">
                    <button className="btn-small" onClick={onUpdatePassword}>정보수정</button>
                    <button className="btn-small" onClick={onLogout}>로그아웃</button>
                </div>
            </div>

            <nav className="nav-menu">
                {menus.map((menu) => (
                    <button
                        key={menu.id}
                        className={`nav-item ${activeTab === menu.id ? 'active' : ''}`}
                        onClick={() => onTabChange(menu.id)}
                    >
                        {menu.label}
                    </button>
                ))}
            </nav>

            <div className="settings-menu">
                <button
                    className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => onTabChange('settings')}
                    style={{ width: '100%' }}
                >
                    ⚙️ 설정메뉴
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
