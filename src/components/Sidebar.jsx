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

    const adminMenus = [
        { id: 'members', label: '회원 및 현장 관리', icon: 'admin_panel_settings' },
        { id: 'settings', label: '설정', icon: 'settings' },
    ];

    // 성(Surname) 추출 (아이콘용)
    const surname = user?.name?.charAt(0) || 'U';

    return (
        <aside className="sidebar">
            {/* 사용자 프로필 영역 (기존 유지) */}
            <div className="user-group">
                <div className="user-info">
                    <div className="user-avatar">{surname}</div>
                    <div className="user-details">
                        <span className="user-name">{user?.name}님</span>
                        <span className="user-role">{user?.site_name1 || '소속 미지정'}</span>
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

            {/* 일반 메뉴 영역 (텍스트형) */}
            <nav className="nav-menu-text">
                {menus.map((menu) => (
                    <button
                        key={menu.id}
                        className={`nav-text-item ${activeTab === menu.id ? 'active' : ''}`}
                        onClick={() => onTabChange(menu.id)}
                    >
                        <span className="material-icons nav-text-icon">{menu.icon}</span>
                        <span>{menu.label}</span>
                    </button>
                ))}
            </nav>

            {/* 관리자 전용 메뉴 (하단 고정) */}
            {user?.role === 'admin' && (
                <div className="nav-admin-section">
                    <div className="nav-admin-divider">관리자 전용</div>
                    {adminMenus.map((menu) => (
                        <button
                            key={menu.id}
                            className={`nav-text-item admin ${activeTab === menu.id ? 'active' : ''}`}
                            onClick={() => onTabChange(menu.id)}
                        >
                            <span className="material-icons nav-text-icon">{menu.icon}</span>
                            <span>{menu.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </aside>
    );
};

export default Sidebar;
