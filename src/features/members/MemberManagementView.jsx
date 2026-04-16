import React, { useEffect, useMemo, useState } from 'react';
import { MEMBER_EDIT_NEW_ROW_KEY, SITE_EDIT_NEW_ROW_KEY, useMemberViewModel } from './useMemberViewModel';
import { useDialog } from '../../components/common/DialogContext';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';
import { getLockedRowEditGridProps } from '../../components/common/advancedDataGridPresets';

class MemberViewErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, message: '' };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, message: error?.message || '알 수 없는 오류' };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[MemberManagementView] render error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '1rem', border: '1px solid #fecaca', borderRadius: '8px', background: '#fff1f2', color: '#9f1239', fontWeight: 700, fontSize: '0.85rem' }}>
                    회원/현장 화면 렌더링 중 오류가 발생했습니다. 화면을 다시 열어 주세요.
                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: '#be123c' }}>
                        오류 메시지: {this.state.message}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

/** 회원관리·현장관리 탭이 같은 `AdvancedDataGrid`를 쓰므로, 여기 값만 바꾸면 두 탭 컬럼 헤더 높이가 함께 바뀜(앱 상단 `layout.css`와 무관). */
const MEMBER_SITE_GRID_HEADER_ROW_HEIGHT = 16;
const MEMBER_SITE_GRID_HEADER_FONT_SIZE = 12;

/**
 * 칼럼 너비를 한 곳에서 관리.
 * - 회원관리 탭: MEMBER_GRID_COLUMN_WIDTHS
 * - 현장관리 탭: SITE_GRID_COLUMN_WIDTHS
 */
const MEMBER_GRID_COLUMN_WIDTHS = {
    name: 100,
    password: 140,
    role: 120,
    phone: 170,
    site_name1: 240,
    selected_label: 100,
};

const SITE_GRID_COLUMN_WIDTHS = {
    site_name: 240,
    manager_name: 170,
    method: 120,
    series: 120,
    selected_label: 130,
};

// 권한 번역 맵
const ROLE_LABEL_MAP = {
    'admin': '최고관리자',
    'group_admin': '중앙관리자',
    'user': '현장관리자'
};

const normalizeRoleValue = (value, fallback = 'user') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;

    if (raw === 'admin' || raw === 'group_admin' || raw === 'user') return raw;
    if (raw === '최고관리자') return 'admin';
    if (raw === '중앙관리자' || raw === '권역통합관리자') return 'group_admin';
    if (raw === '현장관리자' || raw === '일반사용자') return 'user';

    return fallback;
};

const getAutoSiteTextForManager = (siteNames) => {
    if (!Array.isArray(siteNames) || siteNames.length === 0) return '';
    if (siteNames.length > 1) return '양방향';
    return siteNames[0] || '';
};

const MemberManagementView = ({ currentUser, passwordOnly = false }) => {
    const { showAlert, showConfirm } = useDialog();
    const {
        members,
        loading,
        form,
        updateForm,
        submitPasswordOnly,
        viewMode,
        setViewMode,
        handleEdit,
        selectedMemberId,
        selectMember,
        newMemberRow,
        memberEditMode,
        memberEditRowKey,
        setNewMemberRow,
        startNewMemberRow,
        cancelNewMemberRow,
        startEditSelectedMemberRow,
        saveNewMemberRow,
        deleteSelectedMember,
        isSavingMember,
        isDeletingMember,
        sites,
        selectedSiteId,
        selectSite,
        newSiteRow,
        queuedSiteRows,
        siteEditMode,
        siteEditRowKey,
        setNewSiteRow,
        startNewSiteRow,
        cancelNewSiteRow,
        saveNewSiteRow,
        startEditSelectedSiteRow,
        deleteSelectedSite,
        isSavingSite,
        isDeletingSite,
        bootstrapMember,
        setBootstrapMember,
        bootstrapLink,
        setBootstrapLink,
        isBootstrappingSiteMember,
        handleBootstrapSiteMember,
        registerBootstrapLocation
    } = useMemberViewModel({ showAlert, showConfirm });
    const [manageTab, setManageTab] = useState('site');
    const [registerTab, setRegisterTab] = useState('member');

    const memberGridColumns = useMemo(() => ([
        { id: 'name', label: '회원명', width: MEMBER_GRID_COLUMN_WIDTHS.name, align: 'center' },
        { id: 'password', label: '비밀번호', width: MEMBER_GRID_COLUMN_WIDTHS.password, align: 'center' },
        { id: 'role', label: '권한', width: MEMBER_GRID_COLUMN_WIDTHS.role, align: 'center' },
        { id: 'phone', label: '연락처', width: MEMBER_GRID_COLUMN_WIDTHS.phone, align: 'center' },
        { id: 'site_name1', label: '소속 현장', width: MEMBER_GRID_COLUMN_WIDTHS.site_name1, align: 'center' },
        { id: 'selected_label', label: '선택 상태', width: MEMBER_GRID_COLUMN_WIDTHS.selected_label, align: 'center' }
    ]), []);

    const safeMembers = useMemo(() => (Array.isArray(members) ? members.filter(Boolean) : []), [members]);
    const safeSites = useMemo(() => (Array.isArray(sites) ? sites.filter(Boolean) : []), [sites]);

    const getManagedSiteNamesByManagerName = React.useCallback((managerName) => {
        const normalizedManager = String(managerName || '').trim();
        if (!normalizedManager) return [];

        return safeSites
            .filter((site) => String(site?.manager_name || '').trim() === normalizedManager)
            .map((site) => String(site?.site_name || '').trim())
            .filter(Boolean);
    }, [safeSites]);

    const memberGridData = useMemo(() => {
        let rows = safeMembers.map(member => ({
            ...member,
            password: member.password || '',
            role: member.role || 'user',
            role_display: ROLE_LABEL_MAP[member.role] || member.role,
            phone: member.phone || '',
            selected_label: selectedMemberId === member.id ? '선택됨' : ''
        }));

        if (newMemberRow) {
            if (newMemberRow.id) {
                rows = rows.map(row => (
                    row.id === newMemberRow.id
                        ? {
                            ...row,
                            ...newMemberRow,
                            role_display: ROLE_LABEL_MAP[newMemberRow.role] || newMemberRow.role,
                            selected_label: '편집중'
                        }
                        : row
                ));
            } else {
                rows.push({
                    id: MEMBER_EDIT_NEW_ROW_KEY,
                    name: newMemberRow.name || '',
                    password: newMemberRow.password || '',
                    role: newMemberRow.role || 'user',
                    role_display: ROLE_LABEL_MAP[newMemberRow.role || 'user'] || '현장관리자',
                    phone: newMemberRow.phone || '',
                    site_name1: newMemberRow.site_name1 || '',
                    selected_label: '신규'
                });
            }
        }

        return rows;
    }, [safeMembers, selectedMemberId, newMemberRow]);

    const siteGridColumns = useMemo(() => ([
        { id: 'site_name', label: '현장명', width: SITE_GRID_COLUMN_WIDTHS.site_name, align: 'center' },
        { id: 'manager_name', label: '관리자명', width: SITE_GRID_COLUMN_WIDTHS.manager_name, align: 'center' },
        { id: 'method', label: '공법', width: SITE_GRID_COLUMN_WIDTHS.method, align: 'center' },
        { id: 'series', label: '계열', width: SITE_GRID_COLUMN_WIDTHS.series, align: 'center' },
        { id: 'selected_label', label: '선택 상태', width: SITE_GRID_COLUMN_WIDTHS.selected_label, align: 'center' }
    ]), []);

    const lockedGridEditProps = useMemo(
        () => getLockedRowEditGridProps(manageTab === 'site' && siteEditMode, siteEditRowKey),
        [manageTab, siteEditMode, siteEditRowKey]
    );

    const lockedMemberGridEditProps = useMemo(
        () => getLockedRowEditGridProps(manageTab === 'member' && memberEditMode, memberEditRowKey),
        [manageTab, memberEditMode, memberEditRowKey]
    );

    const siteGridData = useMemo(() => {
        let rows = safeSites
            .map(site => ({
                ...site,
                selected_label: selectedSiteId === site.id ? '선택됨' : ''
            }));

        if (Array.isArray(queuedSiteRows) && queuedSiteRows.length > 0) {
            const queuedRows = queuedSiteRows.map((row, idx) => ({
                id: `${SITE_EDIT_NEW_ROW_KEY}_queued_${idx}`,
                site_name: row.siteName || '',
                manager_name: row.managerName || '',
                method: row.method || 'A2O',
                series: row.series || '1계열',
                selected_label: '신규(대기)'
            }));
            rows = [...rows, ...queuedRows];
        }

        if (newSiteRow) {
            if (newSiteRow.siteId) {
                rows = rows.map(row => (
                    row.id === newSiteRow.siteId
                        ? {
                            ...row,
                            site_name: newSiteRow.siteName || '',
                            manager_name: newSiteRow.managerName || '',
                            method: newSiteRow.method || 'A2O',
                            series: newSiteRow.series || '1계열',
                            selected_label: '편집중'
                        }
                        : row
                ));
            } else {
                rows.push({
                    id: SITE_EDIT_NEW_ROW_KEY,
                    site_name: newSiteRow.siteName || '',
                    manager_name: newSiteRow.managerName || '',
                    method: newSiteRow.method || 'A2O',
                    series: newSiteRow.series || '1계열',
                    selected_label: '신규'
                });
            }
        }

        return rows;
    }, [safeSites, selectedSiteId, newSiteRow, queuedSiteRows]);

    // passwordOnly 모드: 진입 시 자기 계정 편집 모드로 자동 전환
    useEffect(() => {
        if (passwordOnly && currentUser) {
            const myMember = safeMembers.find(m => m.name === currentUser.name);
            if (myMember) {
                handleEdit(myMember);
            }
        }
    }, [passwordOnly, currentUser, safeMembers, handleEdit]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (form.password !== form.confirmPassword) {
            await showAlert("비밀번호가 일치하지 않습니다.");
            return;
        }
        if (passwordOnly) {
            submitPasswordOnly();
        }
    };

    // ── 비밀번호 전용 수정 화면 ──
    if (passwordOnly) {
        return (
            <div className="panel-container justify-center">
                <div className="dynamic-panel w-[450px] shadow-2xl border-slate-200">
                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '2px solid #e2e8f0', flexShrink: 0 }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em' }}>
                            내 정보 수정
                        </h1>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '2rem 1.5rem' }}>
                        <form onSubmit={handleSubmit}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>이름</label>
                                    <div
                                        style={{ width: '100%', border: '2px solid #e2e8f0', height: '40px', padding: '0 12px', fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', backgroundColor: '#f8fafc' }}
                                    >
                                        {form.name || currentUser?.name}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>소속</label>
                                    <div
                                        style={{ width: '100%', border: '2px solid #e2e8f0', height: '40px', padding: '0 12px', fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', backgroundColor: '#f8fafc' }}
                                    >
                                        {form.site_name1 || '-'}
                                    </div>
                                </div>
                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>새 비밀번호</label>
                                    <input
                                        type="password"
                                        style={{ width: '100%', border: '2px solid #1e293b', height: '40px', padding: '0 12px', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                        value={form.password}
                                        onChange={e => updateForm({ password: e.target.value })}
                                        required
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>비밀번호 확인</label>
                                    <input
                                        type="password"
                                        style={{ width: '100%', border: '2px solid #1e293b', height: '40px', padding: '0 12px', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                        value={form.confirmPassword}
                                        onChange={e => updateForm({ confirmPassword: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
                                <button
                                    type="submit"
                                    style={{
                                        width: '100%', height: '48px', borderRadius: '12px', border: 'none',
                                        backgroundColor: '#1e293b', color: 'white', fontWeight: 900,
                                        fontSize: '1rem', cursor: 'pointer', transition: 'all 0.15s',
                                        boxShadow: '0 4px 12px rgba(30,41,59,0.2)'
                                    }}
                                >
                                    비밀번호 변경
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <MemberViewErrorBoundary>
            <div style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0, boxSizing: 'border-box', backgroundColor: '#ffffff', padding: '0.8rem 1rem' }}>
            {viewMode === 'list' ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: 'white' }}>
                    <div style={{ padding: '0.05rem 0 0.35rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#1e293b' }}>회원/현장 관리</h1>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                            선택 현장: {safeSites.find(s => s.id === selectedSiteId)?.site_name || '없음'}
                        </span>
                    </div>

                    <div style={{ padding: '0.7rem 0', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={() => setManageTab('member')}
                            style={{ height: '32px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: manageTab === 'member' ? '#0f766e' : 'white', color: manageTab === 'member' ? 'white' : '#334155', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                            회원관리
                        </button>
                        <button
                            onClick={() => setManageTab('site')}
                            style={{ height: '32px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: manageTab === 'site' ? '#0f766e' : 'white', color: manageTab === 'site' ? 'white' : '#334155', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                            현장관리
                        </button>
                    </div>

                    <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                        <AdvancedDataGrid
                            title={manageTab === 'site' ? '' : '기존 회원 리스트'}
                            description={manageTab === 'site' ? '' : '회원 목록 확인 및 선택 편집'}
                            columns={manageTab === 'site' ? siteGridColumns : memberGridColumns}
                            data={manageTab === 'site' ? siteGridData : memberGridData}
                            keyField="id"
                            scrollToKey={
                                manageTab === 'site'
                                    ? (siteEditMode ? siteEditRowKey : null)
                                    : (memberEditMode ? memberEditRowKey : null)
                            }
                            width="100%"
                            height={300}
                            rowHeight={28}
                            headerRowHeight={MEMBER_SITE_GRID_HEADER_ROW_HEIGHT}
                            fontSize={12}
                            headerFontSize={MEMBER_SITE_GRID_HEADER_FONT_SIZE}
                            headerBgColor="#374151"
                            headerTextColor="#f8fafc"
                            activeHeaderBgColor="#1f2937"
                            activeHeaderTextColor="#f8fafc"
                            gridLineColor="#9ca3af"
                            gridLineWidth={1}
                            rowBgColor="#ffffff"
                            altRowBgColor="#f8fafc"
                            hoverRowBgColor="#dbeafe"
                            selectionMode="row"
                            {...(manageTab === 'site' ? lockedGridEditProps : lockedMemberGridEditProps)}
                            commitOnBlur={manageTab === 'member' || manageTab === 'site'}
                            isCellEditable={(row, col) => {
                                if (manageTab === 'site') {
                                    if (!siteEditMode) return false;
                                    if (row.id !== siteEditRowKey) return false;
                                    return ['site_name', 'manager_name', 'method', 'series'].includes(col.id);
                                }
                                if (manageTab === 'member') {
                                    if (!memberEditMode) return false;
                                    if (row.id !== memberEditRowKey) return false;
                                    const editableFields = ['name', 'password', 'role', 'phone', 'site_name1'];
                                    if (!editableFields.includes(col.id)) return false;
                                    // role이 admin이거나 group_admin이면 site_name1은 편집 불가
                                    if (col.id === 'site_name1' && (row.role === 'admin' || row.role === 'group_admin')) {
                                        return false;
                                    }
                                    return true;
                                }
                                return false;
                            }}
                            onCellChange={(row, colId, value) => {
                                if (manageTab === 'site') {
                                    if (!newSiteRow) return;
                                    if (!siteEditMode) return;
                                    if (row.id !== siteEditRowKey) return;

                                    if (colId === 'site_name') setNewSiteRow(prev => ({ ...(prev || {}), siteName: value }));
                                    if (colId === 'manager_name') setNewSiteRow(prev => ({ ...(prev || {}), managerName: value }));
                                    if (colId === 'method') setNewSiteRow(prev => ({ ...(prev || {}), method: value || 'A2O' }));
                                    if (colId === 'series') setNewSiteRow(prev => ({ ...(prev || {}), series: value || '1계열' }));
                                    return;
                                }

                                if (manageTab === 'member') {
                                    if (!newMemberRow) return;
                                    if (!memberEditMode) return;
                                    if (row.id !== memberEditRowKey) return;

                                    if (colId === 'name') {
                                        setNewMemberRow(prev => {
                                            const next = { ...(prev || {}), name: value };
                                            if ((next.role || 'user') === 'user') {
                                                const autoSites = getManagedSiteNamesByManagerName(value);
                                                next.site_name1 = getAutoSiteTextForManager(autoSites);
                                            }
                                            return next;
                                        });
                                    }
                                    if (colId === 'password') setNewMemberRow(prev => ({ ...(prev || {}), password: value }));
                                    if (colId === 'role') {
                                        const currentRole = normalizeRoleValue(newMemberRow?.role, 'user');
                                        const newRole = normalizeRoleValue(value, currentRole);
                                        const isCentralRole = newRole === 'admin' || newRole === 'group_admin';
                                        const autoSites = newRole === 'user'
                                            ? getManagedSiteNamesByManagerName(newMemberRow?.name || '')
                                            : [];
                                        setNewMemberRow(prev => ({
                                            ...(prev || {}),
                                            role: newRole,
                                            site_name1: isCentralRole
                                                ? '중앙 통합관리본부'
                                                : getAutoSiteTextForManager(autoSites)
                                        }));
                                    }
                                    if (colId === 'phone') setNewMemberRow(prev => ({ ...(prev || {}), phone: value }));
                                    if (colId === 'site_name1') setNewMemberRow(prev => ({ ...(prev || {}), site_name1: value }));
                                }
                            }}
                            renderCellDisplay={(row, col, value) => {
                                // 회원 탭에서 role을 한글로 표시
                                if (manageTab === 'member' && col.id === 'role') {
                                    return <div style={{ textAlign: 'center' }}>{ROLE_LABEL_MAP[value] || value}</div>;
                                }
                                return value;
                            }}
                            renderCellEditor={(row, col, value, options) => {
                                if (manageTab === 'member' && col.id === 'role') {
                                    const normalizedValue = normalizeRoleValue(options.value, 'user');
                                    return (
                                        <select
                                            ref={options.inputRef}
                                            value={normalizedValue}
                                            onChange={(e) => {
                                                options.onChange(normalizeRoleValue(e.target.value, 'user'));
                                                options.onCommit?.();
                                            }}
                                            onKeyDown={options.onKeyDown}
                                            style={{ width: '100%', height: '100%', padding: '4px', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
                                            autoFocus
                                        >
                                            <option value="admin">최고관리자</option>
                                            <option value="group_admin">중앙관리자</option>
                                            <option value="user">현장관리자</option>
                                        </select>
                                    );
                                }
                                if (manageTab === 'member' && col.id === 'site_name1') {
                                    const current = options.value || '';
                                    const isCentralRole = newMemberRow?.role === 'admin' || newMemberRow?.role === 'group_admin';
                                    
                                    if (isCentralRole) {
                                        return (
                                            <div
                                                style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    padding: '4px',
                                                    border: '1px solid #cbd5e1',
                                                    borderRadius: '4px',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    backgroundColor: '#f3f4f6',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    color: '#6b7280'
                                                }}
                                            >
                                                중앙 통합관리본부
                                            </div>
                                        );
                                    }
                                    
                                    const optionNames = (safeSites || []).map((site) => site.site_name || '').filter(Boolean);
                                    const mergedOptions = current && !optionNames.includes(current)
                                        ? [current, ...optionNames]
                                        : optionNames;

                                    return (
                                        <select
                                            ref={options.inputRef}
                                            value={current}
                                            onChange={(e) => options.onChange(e.target.value)}
                                            onBlur={options.onCommit}
                                            onKeyDown={options.onKeyDown}
                                            style={{ width: '100%', height: '100%', padding: '4px', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
                                            autoFocus
                                        >
                                            {mergedOptions.map((siteName) => (
                                                <option key={siteName} value={siteName}>{siteName}</option>
                                            ))}
                                        </select>
                                    );
                                }
                                if (col.id === 'method') {
                                    return (
                                        <select
                                            ref={options.inputRef}
                                            value={options.value || 'A2O'}
                                            onChange={(e) => {
                                                options.onChange(e.target.value);
                                                options.onCommit?.();
                                            }}
                                            onBlur={options.onCommit}
                                            onKeyDown={options.onKeyDown}
                                            style={{ width: '100%', height: '100%', padding: '4px', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
                                            autoFocus
                                        >
                                            <option value="A2O">A2O</option>
                                            <option value="MBR">MBR</option>
                                        </select>
                                    );
                                }
                                if (col.id === 'series') {
                                    return (
                                        <select
                                            ref={options.inputRef}
                                            value={options.value || '1계열'}
                                            onChange={(e) => {
                                                options.onChange(e.target.value);
                                                options.onCommit?.();
                                            }}
                                            onBlur={options.onCommit}
                                            onKeyDown={options.onKeyDown}
                                            style={{ width: '100%', height: '100%', padding: '4px', border: '1px solid #3b82f6', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
                                            autoFocus
                                        >
                                            <option value="1계열">1계열</option>
                                            <option value="2계열">2계열</option>
                                        </select>
                                    );
                                }
                                // 현장명, 관리자명은 기본 input 사용 (null 반환)
                                return null;
                            }}
                            contextMenu={false}
                            showBottomBar={false}
                            rowHeaderWidth={70}
                            rowHeaderLabel="No"
                            loading={loading}
                            onRowSelect={(row) => {
                                if (manageTab === 'site') {
                                    if (!row?.id) return;
                                    if (siteEditMode) return;
                                    if (row.id !== SITE_EDIT_NEW_ROW_KEY) {
                                        selectSite(row.id);
                                    }
                                    return;
                                }

                                if (manageTab === 'member') {
                                    if (!row?.id) return;
                                    if (memberEditMode) return;
                                    if (row.id !== MEMBER_EDIT_NEW_ROW_KEY) {
                                        selectMember(row.id);
                                    }
                                }
                            }}
                            onCellDoubleClick={() => { }}
                            getRowStyle={(row) => {
                                if (manageTab === 'site' && selectedSiteId === row.id) return { backgroundColor: '#ecfeff' };
                                if (manageTab === 'member' && selectedMemberId === row.id) return { backgroundColor: '#ecfeff' };
                                return null;
                            }}
                        />
                    </div>

                    <div style={{ padding: '0.9rem 0', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700 }}>
                            {manageTab === 'site'
                                ? `현장 행 추가를 반복한 뒤 저장 시 일괄 저장됩니다.${queuedSiteRows?.length ? ` (대기 ${queuedSiteRows.length}행)` : ''}`
                                : '회원 행 추가 후 그리드에서 바로 입력하세요.'}
                        </span>
                        {manageTab === 'site' ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {newSiteRow ? (
                                    <>
                                        {!newSiteRow.siteId && (
                                            <button
                                                onClick={startNewSiteRow}
                                                disabled={isSavingSite}
                                                style={{ height: '34px', padding: '0 14px', backgroundColor: '#0f766e', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: isSavingSite ? 'not-allowed' : 'pointer', opacity: isSavingSite ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '5px' }}
                                            >
                                                <span className="material-icons" style={{ fontSize: '14px' }}>add</span>
                                                현장 행 추가
                                            </button>
                                        )}
                                        <button
                                            onClick={cancelNewSiteRow}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: 'white', color: '#475569', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.76rem', cursor: 'pointer' }}
                                        >
                                            취소
                                        </button>
                                        <button
                                            onClick={saveNewSiteRow}
                                            disabled={isSavingSite}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: '#0f766e', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: isSavingSite ? 'not-allowed' : 'pointer', opacity: isSavingSite ? 0.7 : 1 }}
                                        >
                                            {isSavingSite
                                                ? '저장 중...'
                                                : (newSiteRow.siteId
                                                    ? '수정 저장'
                                                    : `현장 저장${queuedSiteRows?.length ? ` (${queuedSiteRows.length + 1}행)` : ''}`)}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={startNewSiteRow}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: '#0f766e', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
                                        >
                                            <span className="material-icons" style={{ fontSize: '14px' }}>add</span>
                                            현장 행 추가
                                        </button>
                                        <button
                                            onClick={startEditSelectedSiteRow}
                                            disabled={!selectedSiteId}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: 'white', color: '#1f2937', borderRadius: '8px', border: '1px solid #9ca3af', fontWeight: 800, fontSize: '0.76rem', cursor: !selectedSiteId ? 'not-allowed' : 'pointer', opacity: !selectedSiteId ? 0.6 : 1 }}
                                        >
                                            수정
                                        </button>
                                        <button
                                            onClick={deleteSelectedSite}
                                            disabled={!selectedSiteId || isDeletingSite}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: '#ef4444', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: (!selectedSiteId || isDeletingSite) ? 'not-allowed' : 'pointer', opacity: (!selectedSiteId || isDeletingSite) ? 0.6 : 1 }}
                                        >
                                            {isDeletingSite ? '삭제 중...' : '삭제'}
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {memberEditMode ? (
                                    <>
                                        <button
                                            onClick={cancelNewMemberRow}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: 'white', color: '#475569', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.76rem', cursor: 'pointer' }}
                                        >
                                            취소
                                        </button>
                                        <button
                                            onClick={saveNewMemberRow}
                                            disabled={isSavingMember}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: '#0f766e', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: isSavingMember ? 'not-allowed' : 'pointer', opacity: isSavingMember ? 0.7 : 1 }}
                                        >
                                            {isSavingMember ? '저장 중...' : (newMemberRow?.id ? '수정 저장' : '회원 저장')}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={startNewMemberRow}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: '#0f766e', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
                                        >
                                            <span className="material-icons" style={{ fontSize: '14px' }}>add</span>
                                            회원 행 추가
                                        </button>
                                        <button
                                            onClick={startEditSelectedMemberRow}
                                            disabled={!selectedMemberId}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: 'white', color: '#1f2937', borderRadius: '8px', border: '1px solid #9ca3af', fontWeight: 800, fontSize: '0.76rem', cursor: !selectedMemberId ? 'not-allowed' : 'pointer', opacity: !selectedMemberId ? 0.6 : 1 }}
                                        >
                                            수정
                                        </button>
                                        <button
                                            onClick={deleteSelectedMember}
                                            disabled={!selectedMemberId || isDeletingMember}
                                            style={{ height: '34px', padding: '0 14px', backgroundColor: '#ef4444', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.76rem', cursor: (!selectedMemberId || isDeletingMember) ? 'not-allowed' : 'pointer', opacity: (!selectedMemberId || isDeletingMember) ? 0.6 : 1 }}
                                        >
                                            {isDeletingMember ? '삭제 중...' : '삭제'}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white' }}>
                    <div style={{ padding: '0.2rem 0', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={() => setViewMode('list')}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', border: '1px solid #cbd5e1', borderRadius: '7px', background: 'white', cursor: 'pointer', color: '#475569' }}
                            >
                                <span className="material-icons" style={{ fontSize: '16px' }}>arrow_back</span>
                            </button>
                            <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: '#1e293b' }}>회원/현장 등록</h1>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>
                            대상 현장: {safeSites.find(s => s.id === selectedSiteId)?.site_name || '미선택'}
                        </span>
                    </div>

                    <div style={{ padding: '0.7rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem', backgroundColor: '#f8fafc' }}>
                        <button
                            onClick={() => setRegisterTab('member')}
                            style={{ height: '32px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: registerTab === 'member' ? '#0f766e' : 'white', color: registerTab === 'member' ? 'white' : '#334155', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                            회원 등록
                        </button>
                        <button
                            onClick={() => {
                                setRegisterTab('site');
                                if (!newSiteRow) startNewSiteRow();
                            }}
                            style={{ height: '32px', padding: '0 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: registerTab === 'site' ? '#0f766e' : 'white', color: registerTab === 'site' ? 'white' : '#334155', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                            현장 등록
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
                        {registerTab === 'member' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem' }}>
                                    <input placeholder="회원명" value={bootstrapMember.name} onChange={e => setBootstrapMember({ ...bootstrapMember, name: e.target.value })} style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem' }} />
                                    <input type="password" placeholder="비밀번호" value={bootstrapMember.password} onChange={e => setBootstrapMember({ ...bootstrapMember, password: e.target.value })} style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem' }} />
                                    <input placeholder="연락처" value={bootstrapMember.phone} onChange={e => setBootstrapMember({ ...bootstrapMember, phone: e.target.value })} style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem' }} />
                                    <select value={normalizeRoleValue(bootstrapMember.role, 'user')} onChange={e => setBootstrapMember({ ...bootstrapMember, role: normalizeRoleValue(e.target.value, 'user') })} style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem', backgroundColor: 'white' }}><option value="admin">최고관리자</option><option value="group_admin">중앙관리자</option><option value="user">현장관리자</option></select>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 0.9fr 1fr', gap: '0.5rem', alignItems: 'center' }}>
                                    <button onClick={registerBootstrapLocation} style={{ height: '34px', border: '1px solid #86efac', borderRadius: '7px', background: '#f0fdf4', color: '#166534', fontWeight: 800, fontSize: '0.74rem', cursor: 'pointer' }}>{bootstrapMember.target_lat != null ? '현재위치 등록 완료' : '현재위치 등록'}</button>
                                    <input readOnly value={bootstrapMember.target_lat != null ? String(bootstrapMember.target_lat) : ''} placeholder="위도" style={{ height: '34px', border: '1px solid #e2e8f0', borderRadius: '7px', padding: '0 10px', fontSize: '0.74rem', color: '#64748b', background: '#f8fafc' }} />
                                    <input readOnly value={bootstrapMember.target_lng != null ? String(bootstrapMember.target_lng) : ''} placeholder="경도" style={{ height: '34px', border: '1px solid #e2e8f0', borderRadius: '7px', padding: '0 10px', fontSize: '0.74rem', color: '#64748b', background: '#f8fafc' }} />
                                    <input type="number" placeholder="허용반경(m)" value={bootstrapMember.radius_m} onChange={e => setBootstrapMember({ ...bootstrapMember, radius_m: e.target.value })} style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem' }} />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                                        <label style={{ fontSize: '0.75rem', color: '#334155', display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={bootstrapLink.isPrimary} onChange={e => setBootstrapLink({ ...bootstrapLink, isPrimary: e.target.checked })} />주현장</label>
                                        <label style={{ fontSize: '0.75rem', color: '#334155', display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={bootstrapLink.canManage} onChange={e => setBootstrapLink({ ...bootstrapLink, canManage: e.target.checked })} />관리권한</label>
                                        <label style={{ fontSize: '0.75rem', color: '#334155', display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={bootstrapLink.isBidirectional} onChange={e => setBootstrapLink({ ...bootstrapLink, isBidirectional: e.target.checked })} />양방향</label>
                                    </div>

                                    <button onClick={handleBootstrapSiteMember} disabled={isBootstrappingSiteMember || !selectedSiteId} style={{ height: '34px', padding: '0 12px', border: 'none', borderRadius: '7px', backgroundColor: '#0f766e', color: 'white', fontWeight: 800, fontSize: '0.75rem', cursor: (isBootstrappingSiteMember || !selectedSiteId) ? 'not-allowed' : 'pointer', opacity: (isBootstrappingSiteMember || !selectedSiteId) ? 0.7 : 1 }}>{isBootstrappingSiteMember ? '저장 중...' : '회원 등록 저장'}</button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '760px' }}>
                                {!newSiteRow ? (
                                    <button onClick={startNewSiteRow} style={{ width: '150px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', backgroundColor: '#ffffff', color: '#334155', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>현장 입력 시작</button>
                                ) : (
                                    <>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr 0.8fr', gap: '0.5rem' }}>
                                            <input value={newSiteRow.siteName} onChange={e => setNewSiteRow({ ...newSiteRow, siteName: e.target.value })} placeholder="현장명" style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem' }} />
                                            <input value={newSiteRow.managerName} onChange={e => setNewSiteRow({ ...newSiteRow, managerName: e.target.value })} placeholder="관리자명" style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem' }} />
                                            <select value={newSiteRow.method} onChange={e => setNewSiteRow({ ...newSiteRow, method: e.target.value })} style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem', backgroundColor: 'white' }}>
                                                <option value="A2O">A2O</option>
                                                <option value="MBR">MBR</option>
                                                <option value="SBR">SBR</option>
                                            </select>
                                            <select value={newSiteRow.series} onChange={e => setNewSiteRow({ ...newSiteRow, series: e.target.value })} style={{ height: '34px', border: '1px solid #cbd5e1', borderRadius: '7px', padding: '0 10px', fontSize: '0.75rem', backgroundColor: 'white' }}>
                                                <option value="1계열">1계열</option>
                                                <option value="2계열">2계열</option>
                                            </select>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button onClick={saveNewSiteRow} disabled={isSavingSite} style={{ height: '34px', padding: '0 14px', border: 'none', borderRadius: '7px', backgroundColor: '#0f766e', color: 'white', fontWeight: 800, fontSize: '0.75rem', cursor: isSavingSite ? 'not-allowed' : 'pointer', opacity: isSavingSite ? 0.7 : 1 }}>
                                                {isSavingSite ? '저장 중...' : `현장 저장${queuedSiteRows?.length ? ` (${queuedSiteRows.length + 1}행)` : ''}`}
                                            </button>
                                            <button onClick={cancelNewSiteRow} style={{ height: '34px', padding: '0 14px', border: '1px solid #cbd5e1', borderRadius: '7px', backgroundColor: 'white', color: '#475569', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer' }}>취소</button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
            </div>
        </MemberViewErrorBoundary>
    );
};

export default MemberManagementView;
