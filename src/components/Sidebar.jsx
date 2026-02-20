import React from 'react';
import { MENUS, ADMIN_MENUS, ADMIN_ROLES } from '../core/constants';

const Sidebar = ({ user, activeTab, onTabChange, onLogout, onUpdatePassword }) => {

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
                {MENUS.map((menu) => (
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
            {ADMIN_ROLES.includes(user?.role) && (
                <div className="nav-admin-section">
                    <div className="nav-admin-divider">관리망 메뉴</div>
                    {ADMIN_MENUS.map((menu) => (
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
