import React from 'react';
import { MENUS, ADMIN_MENUS, ADMIN_ROLES } from '../core/constants';

const Sidebar = ({ user, activeTab, onTabChange, onLogout, onUpdatePassword }) => {

    // 성(Surname) 추출 (아이콘용)
    const surname = user?.name?.charAt(0) || 'U';

    const [expandedMenus, setExpandedMenus] = React.useState(['log', 'water_group']);
    const managedSites = Array.isArray(user?.managed_sites) ? user.managed_sites : [];
    const multiSiteEnabled = user?.multi_site_enabled === true;
    const pairedSiteIds = [user?.primary_site_id, user?.secondary_site_id].map(String).filter(Boolean);
    const pairedSites = multiSiteEnabled
        ? pairedSiteIds.map((id) => managedSites.find((site) => String(site.id) === id)).filter(Boolean)
        : [];
    const directionLabel = (siteName) => String(siteName || '').match(/([가-힣A-Za-z0-9]+방향)/)?.[1] || String(siteName || '');

    const handleSiteWindow = async (site) => {
        if (!site || String(site.id) === String(user?.site_id || '')) return;
        await window.electronAPI?.openSiteWindow?.({ siteId: site.id, siteName: site.site_name });
    };

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
                    <button className="btn-small" onClick={onLogout}>
                        <span className="material-icons" style={{ fontSize: '14px' }}>logout</span>
                        로그아웃
                    </button>
                    {pairedSites.length === 2 ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                            {pairedSites.map((site) => {
                                const active = String(site.id) === String(user?.site_id || '');
                                return (
                                    <button
                                        key={site.id}
                                        type="button"
                                        onClick={() => handleSiteWindow(site)}
                                        aria-pressed={active}
                                        title={active ? `${site.site_name} - 현재 창` : `${site.site_name} 창 열기`}
                                        style={{
                                            minWidth: 0,
                                            height: '30px',
                                            padding: '0 5px',
                                            borderRadius: '7px',
                                            border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
                                            backgroundColor: active ? '#2563eb' : '#fff',
                                            color: active ? '#fff' : '#334155',
                                            fontSize: '0.68rem',
                                            fontWeight: 800,
                                            cursor: active ? 'default' : 'pointer',
                                        }}
                                    >
                                        {directionLabel(site.site_name)}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
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
                                {menu.children.map(sub => (
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
