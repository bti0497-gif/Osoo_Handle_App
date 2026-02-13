import React from 'react';

const Sidebar = ({ user, activeTab, onTabChange, onLogout, onUpdatePassword }) => {
    const menus = [
        { id: 'flow', label: '유량관리', icon: 'water_damage' },
        { id: 'medicine', label: '약품관리', icon: 'science' },
        { id: 'water', label: '수질관리', icon: 'opacity' },
        { id: 'facility', label: '시설관리', icon: 'construction' },
        { id: 'log', label: '일지작성', icon: 'edit_note' },
        { id: 'board', label: '소통게시판', icon: 'forum' },
    ];

    // 성(Surname) 추출 (아이콘용)
    const surname = user?.name?.charAt(0) || 'U';

    return (
        <aside className="sidebar">
            <div className="user-group">
                <div className="user-info">
                    <div className="user-avatar">{surname}</div>
                    <div className="user-details">
                        <span className="user-role">현장 근무자</span>
                        <span className="user-name">{user?.name}님</span>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button className="btn-small" onClick={onUpdatePassword}>
                        <span className="material-icons" style={{ fontSize: '14px' }}>edit</span>
                        정보수정
                    </button>
                    <button className="btn-small" onClick={onLogout}>
                        <span className="material-icons" style={{ fontSize: '14px' }}>logout</span>
                        로그아웃
                    </button>
                </div>
            </div>

            <div className="nav-menu">
                {menus.map((menu) => (
                    <button
                        key={menu.id}
                        className={`nav-item ${activeTab === menu.id ? 'active' : ''}`}
                        onClick={() => onTabChange(menu.id)}
                    >
                        <span className="material-icons menu-icon">{menu.icon}</span>
                        <span>{menu.label}</span>
                    </button>
                ))}

                {user?.role === 'admin' && (
                    <button
                        className={`nav-item ${activeTab === 'members' ? 'active' : ''}`}
                        onClick={() => onTabChange('members')}
                        style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}
                    >
                        <span className="material-icons menu-icon">admin_panel_settings</span>
                        <span>회원 및 현장 관리</span>
                    </button>
                )}
            </div>

            <div style={{ marginTop: 'auto', padding: '0.75rem' }}>
                <button
                    className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => onTabChange('settings')}
                >
                    <span className="material-icons menu-icon">settings</span>
                    <span>설정메뉴</span>
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
