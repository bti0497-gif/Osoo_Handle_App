import React from 'react';
import { MENUS, ADMIN_MENUS, ADMIN_ROLES } from '../core/constants';

const Sidebar = ({ user, activeTab, onTabChange, onLogout, onUpdatePassword, onSiteChange }) => {

    // 성(Surname) 추출 (아이콘용)
    const surname = user?.name?.charAt(0) || 'U';

    const [expandedMenus, setExpandedMenus] = React.useState(['log', 'water_group']);
    const managedSites = Array.isArray(user?.managed_sites) ? user.managed_sites : [];
    const isBidirectionalUser = String(user?.site_name1 || '').trim() === '양방향';
    const managerOwnedSites = managedSites.filter((site) => String(site?.manager_name || '').trim() === String(user?.name || '').trim());
    const visibleManagedSites = isBidirectionalUser ? managerOwnedSites : [];
    const showSiteDropdown = visibleManagedSites.length > 0;
    const siteSelectValue = showSiteDropdown
        ? (visibleManagedSites.some((site) => String(site.id) === String(user?.site_id || ''))
            ? String(user?.site_id || '')
            : String(visibleManagedSites[0]?.id || ''))
        : '';

    const toggleMenu = (menuId) => {
        setExpandedMenus(prev =>
            prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId]
        );
    };

    const handleMenuClick = (menu) => {
        if (menu.children) {
            toggleMenu(menu.id);
        } else {
            onTabChange(menu.id);
        }
    };

    return (
        <aside className="sidebar">
            {/* 사용자 프로필 영역 (기존 유지) */}
            <div className="user-group">
                <div className="user-info" style={{ cursor: 'pointer' }} onClick={onUpdatePassword} title="내 정보 수정">
                    <div className="user-avatar">{surname}</div>
                    <div className="user-details">
                        <span className="user-name">{user?.name}님</span>
                        <span className="user-role">{user?.notes || user?.site_name1 || '소속 미지정'}</span>
                    </div>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {showSiteDropdown ? (
                        <div>
                            <select
                                value={siteSelectValue}
                                onChange={(e) => onSiteChange?.(e.target.value)}
                                style={{
                                    height: '32px',
                                    borderRadius: '8px',
                                    border: '1px solid #cbd5e1',
                                    padding: '0 10px',
                                    backgroundColor: '#fff',
                                    color: '#1e293b',
                                    fontSize: '0.75rem',
                                    fontWeight: 700
                                }}
                            >
                                {visibleManagedSites.map((site) => (
                                    <option key={site.id} value={site.id}>{site.site_name}</option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                    <button className="btn-small" onClick={onLogout}>
                        <span className="material-icons" style={{ fontSize: '14px' }}>logout</span>
                        로그아웃
                    </button>
                </div>
            </div>

            {/* 일반 메뉴 영역 (텍스트형) */}
            <nav className="nav-menu-text">
                {MENUS.map((menu) => (
                    <React.Fragment key={menu.id}>
                        <button
                            className={`nav-text-item ${activeTab === menu.id ? 'active' : ''}`}
                            onClick={() => handleMenuClick(menu)}
                        >
                            <span className="material-icons nav-text-icon">{menu.icon}</span>
                            <span>{menu.label}</span>
                            {menu.children && (
                                <span className={`material-icons nav-text-expand-icon ${expandedMenus.includes(menu.id) ? 'expanded' : ''}`}>
                                    chevron_right
                                </span>
                            )}
                        </button>
                        {menu.children && expandedMenus.includes(menu.id) && (
                            <div className="nav-submenu-container">
                                {menu.children
                                    .filter(sub => sub.id !== 'certificate')
                                    .map(sub => (
                                    <button
                                        key={sub.id}
                                        className={`nav-submenu-item ${activeTab === sub.id ? 'active' : ''}`}
                                        onClick={() => onTabChange(sub.id)}
                                    >
                                        {sub.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </React.Fragment>
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
