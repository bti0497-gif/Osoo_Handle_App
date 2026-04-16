import { useState, useEffect } from 'react';
import { MemberModel } from './MemberModel';
import { apiClient } from '../../core/api';
import { SyncService } from '../auth/SyncService';

export const SITE_EDIT_NEW_ROW_KEY = '__new_site_row__';
export const MEMBER_EDIT_NEW_ROW_KEY = '__new_member_row__';
const ROLE_NOTE_MAP = {
    admin: '최고관리자',
    group_admin: '중앙관리자',
    user: '현장관리자'
};

export const useMemberViewModel = ({ showAlert, showConfirm } = {}) => {
    const [members, setMembers] = useState([]);
    const [sites, setSites] = useState([]);
    const [selectedSiteId, setSelectedSiteId] = useState(null);
    const [newSiteRow, setNewSiteRow] = useState(null);
    const [queuedSiteRows, setQueuedSiteRows] = useState([]);
    const [siteEditMode, setSiteEditMode] = useState(false);
    const [siteEditRowKey, setSiteEditRowKey] = useState(null);
    const [selectedMemberId, setSelectedMemberId] = useState(null);
    const [newMemberRow, setNewMemberRow] = useState(null);
    const [memberEditMode, setMemberEditMode] = useState(false);
    const [memberEditRowKey, setMemberEditRowKey] = useState(null);
    const [isSavingMember, setIsSavingMember] = useState(false);
    const [isDeletingMember, setIsDeletingMember] = useState(false);
    const [isSavingSite, setIsSavingSite] = useState(false);
    const [isDeletingSite, setIsDeletingSite] = useState(false);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState('list');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const membersPerPage = 10;

    const [form, setForm] = useState({
        name: '',
        password: '',
        confirmPassword: '',
        phone: '',
        site_name1: '',
        target_lat: null,
        target_lng: null,
        radius_m: 500,
        notes: '',
        role: 'admin'
    });
    const [bootstrapMember, setBootstrapMember] = useState({
        name: '',
        password: '',
        phone: '',
        role: 'admin',
        target_lat: null,
        target_lng: null,
        radius_m: 500,
        notes: ''
    });
    const [bootstrapLink, setBootstrapLink] = useState({
        isPrimary: true,
        canManage: true,
        isBidirectional: false
    });
    const [isBootstrappingSiteMember, setIsBootstrappingSiteMember] = useState(false);

    useEffect(() => {
        loadMembers();
        loadSites();
    }, []);

    const loadSites = async () => {
        try {
            const data = await MemberModel.fetchSites();
            setSites(data.sites || []);
            setSelectedSiteId(data.currentSiteId || data.sites?.[0]?.id || null);
            if (data.currentSiteId) {
                const selected = (data.sites || []).find(s => s.id === data.currentSiteId);
                if (selected) {
                    setBootstrapMember(prev => ({ ...prev, name: prev.name || selected.manager_name || '' }));
                }
            }
        } catch (err) {
            console.warn('사이트 기본값 로드 실패:', err?.message || err);
        }
    };

    const selectSite = async (siteId) => {
        try {
            await MemberModel.selectSite(siteId);
            setSelectedSiteId(siteId);
            const selected = sites.find(s => s.id === siteId);
            if (selected) {
                setBootstrapMember(prev => ({ ...prev, name: prev.name || selected.manager_name || '' }));
            }
        } catch (err) {
            showAlert?.('현장 선택 실패: ' + err.message);
        }
    };

    const startNewSiteRow = () => {
        const hasCurrentNewRow = !!newSiteRow && !newSiteRow.siteId;
        if (hasCurrentNewRow) {
            const hasAnyValue = Boolean(
                String(newSiteRow.siteName || '').trim() ||
                String(newSiteRow.managerName || '').trim() ||
                String(newSiteRow.method || '').trim() ||
                String(newSiteRow.series || '').trim()
            );
            if (hasAnyValue) {
                setQueuedSiteRows(prev => ([
                    ...prev,
                    {
                        siteName: String(newSiteRow.siteName || '').trim(),
                        managerName: String(newSiteRow.managerName || '').trim(),
                        method: String(newSiteRow.method || 'A2O').trim(),
                        series: String(newSiteRow.series || '1계열').trim()
                    }
                ]));
            }
        } else if (siteEditMode) {
            return;
        }

        setNewSiteRow({
            siteName: '',
            managerName: '',
            method: 'A2O',
            series: '1계열'
        });
        setSiteEditMode(true);
        setSiteEditRowKey(SITE_EDIT_NEW_ROW_KEY);
    };

    const cancelNewSiteRow = () => {
        setNewSiteRow(null);
        setQueuedSiteRows([]);
        setSiteEditMode(false);
        setSiteEditRowKey(null);
    };

    const saveNewSiteRow = async () => {
        const isEditingExisting = Boolean(newSiteRow?.siteId);
        const rowsToSave = isEditingExisting
            ? [newSiteRow]
            : [
                ...queuedSiteRows,
                ...(newSiteRow ? [newSiteRow] : [])
            ];
        if (rowsToSave.length === 0) {
            showAlert?.('저장할 현장 행이 없습니다.');
            return;
        }

        const invalidIndex = rowsToSave.findIndex((row) => !String(row?.siteName || '').trim());
        if (invalidIndex >= 0) {
            showAlert?.(`현장명은 필수입니다. (${invalidIndex + 1}번째 행)`);
            return;
        }

        setIsSavingSite(true);
        try {
            let lastSaved = null;
            for (const row of rowsToSave) {
                lastSaved = await MemberModel.saveSite(row);
            }
            setNewSiteRow(null);
            setQueuedSiteRows([]);
            setSiteEditMode(false);
            setSiteEditRowKey(null);
            await loadSites();
            if (lastSaved?.id) {
                await selectSite(lastSaved.id);
            }
            showAlert?.(
                isEditingExisting
                    ? '현장 정보가 수정되었습니다.'
                    : `${rowsToSave.length}개 현장이 저장되었습니다.`
            );
        } catch (err) {
            showAlert?.('현장 저장 실패: ' + err.message);
        } finally {
            setIsSavingSite(false);
        }
    };

    const startEditSelectedSiteRow = () => {
        if (!selectedSiteId) {
            showAlert?.('수정할 현장을 먼저 선택해 주세요.');
            return;
        }
        const selected = sites.find(s => s.id === selectedSiteId);
        if (!selected) {
            showAlert?.('선택된 현장 정보를 찾을 수 없습니다.');
            return;
        }
        setNewSiteRow({
            siteId: selected.id,
            siteName: selected.site_name || '',
            managerName: selected.manager_name || '',
            method: selected.method || 'A2O',
            series: selected.series || '1계열'
        });
        setSiteEditMode(true);
        setSiteEditRowKey(selected.id);
    };

    const deleteSelectedSite = async () => {
        if (!selectedSiteId) {
            showAlert?.('삭제할 현장을 먼저 선택해 주세요.');
            return;
        }

        showConfirm?.(
            '현장 삭제',
            '선택한 현장을 삭제하시겠습니까? 삭제 후 목록에서 숨김 처리됩니다.',
            async () => {
                setIsDeletingSite(true);
                try {
                    await MemberModel.deleteSite(selectedSiteId);
                    setNewSiteRow(null);
                    setSiteEditMode(false);
                    setSiteEditRowKey(null);
                    await loadSites();
                    showAlert?.('현장이 삭제되었습니다.');
                } catch (err) {
                    showAlert?.('현장 삭제 실패: ' + err.message);
                } finally {
                    setIsDeletingSite(false);
                }
            }
        );
    };

    const loadMembers = async () => {
        setLoading(true);
        try {
            const data = await MemberModel.fetchMembers();
            setMembers(data);
            const safe = Array.isArray(data) ? data : [];
            if (!safe.some(member => String(member.id) === String(selectedMemberId))) {
                setSelectedMemberId(safe[0]?.id || null);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const selectMember = (memberId) => {
        if (memberEditMode) return;
        setSelectedMemberId(memberId || null);
    };

    const startNewMemberRow = () => {
        if (memberEditMode) return;
        const selectedSite = sites.find(site => site.id === selectedSiteId);
        setNewMemberRow({
            name: '',
            password: '',
            phone: '',
            role: 'user',
            site_name1: selectedSite?.site_name || ''
        });
        setMemberEditMode(true);
        setMemberEditRowKey(MEMBER_EDIT_NEW_ROW_KEY);
    };

    const cancelNewMemberRow = () => {
        setNewMemberRow(null);
        setMemberEditMode(false);
        setMemberEditRowKey(null);
    };

    const startEditSelectedMemberRow = () => {
        if (!selectedMemberId) {
            showAlert?.('수정할 회원을 먼저 선택해 주세요.');
            return;
        }

        const selected = members.find(member => String(member.id) === String(selectedMemberId));
        if (!selected) {
            showAlert?.('선택된 회원 정보를 찾을 수 없습니다.');
            return;
        }

        setNewMemberRow({
            id: selected.id,
            name: selected.name || '',
            password: selected.password || '',
            phone: selected.phone || '',
            role: selected.role || 'admin',
            site_name1: selected.site_name1 || ''
        });
        setMemberEditMode(true);
        setMemberEditRowKey(selected.id);
    };

    const saveNewMemberRow = async () => {
        if (!newMemberRow?.name?.trim()) {
            showAlert?.('회원명을 입력해 주세요.');
            return;
        }

        const editingExisting = !!newMemberRow?.id;
        const selected = editingExisting
            ? members.find(member => String(member.id) === String(newMemberRow.id))
            : null;
        const passwordToSave = (newMemberRow?.password || '').trim() || selected?.password || '';
        if (!passwordToSave) {
            showAlert?.('비밀번호를 입력해 주세요.');
            return;
        }

        setIsSavingMember(true);
        try {
            const payload = {
                ...newMemberRow,
                password: passwordToSave,
                role: newMemberRow.role || 'admin',
                notes: ROLE_NOTE_MAP[newMemberRow.role || 'admin'] || ''
            };
            const saved = await MemberModel.saveMember(payload);
            setNewMemberRow(null);
            setMemberEditMode(false);
            setMemberEditRowKey(null);
            await loadMembers();
            setSelectedMemberId(saved?.id || payload.id || null);
            showAlert?.(editingExisting ? '회원 정보가 수정되었습니다.' : '새 회원이 저장되었습니다.');
        } catch (err) {
            showAlert?.('회원 저장 실패: ' + err.message);
        } finally {
            setIsSavingMember(false);
        }
    };

    const deleteSelectedMember = async () => {
        if (!selectedMemberId) {
            showAlert?.('삭제할 회원을 먼저 선택해 주세요.');
            return;
        }

        showConfirm?.(
            '회원 삭제',
            '선택한 회원을 삭제하시겠습니까?',
            async () => {
                setIsDeletingMember(true);
                try {
                    await MemberModel.deleteMember(selectedMemberId);
                    setNewMemberRow(null);
                    setMemberEditMode(false);
                    setMemberEditRowKey(null);
                    await loadMembers();
                    showAlert?.('회원이 삭제되었습니다.');
                } catch (err) {
                    showAlert?.('회원 삭제 실패: ' + err.message);
                } finally {
                    setIsDeletingMember(false);
                }
            }
        );
    };

    const updateForm = (updates) => {
        setForm(prev => ({ ...prev, ...updates }));
    };

    const registerCurrentLocation = async () => {
        try {
            const data = await apiClient.get('/api/location/current');

            if (data.success) {
                updateForm({
                    target_lat: data.latitude,
                    target_lng: data.longitude
                });
            } else {
                showAlert?.(data.message || '위치 정보를 가져올 수 없습니다.');
            }
        } catch {
            showAlert?.('위치 서비스 연결 실패.\n서버가 실행 중인지 확인해 주세요.');
        }
    };

    const registerBootstrapLocation = async () => {
        try {
            const data = await apiClient.get('/api/location/current');
            if (data.success) {
                setBootstrapMember(prev => ({
                    ...prev,
                    target_lat: data.latitude,
                    target_lng: data.longitude
                }));
            } else {
                showAlert?.(data.message || '위치 정보를 가져올 수 없습니다.');
            }
        } catch {
            showAlert?.('위치 서비스 연결 실패. 서버 상태를 확인해 주세요.');
        }
    };

    const submitForm = async () => {
        if (form.password !== form.confirmPassword) {
            showAlert?.("비밀번호가 일치하지 않습니다.");
            return { success: false };
        }
        try {
            const dataToSave = {
                ...form
            };
            delete dataToSave.confirmPassword;

            await MemberModel.saveMember(dataToSave);

            // saveMember가 로컬 DB + Google Sheets 동시 저장하므로 별도 동기화 불필요

            showAlert?.("저장 완료");
            await loadMembers();
            resetForm();
            setViewMode('list');
            return { success: true };
        } catch (err) {
            showAlert?.("저장 실패: " + err.message);
            return { success: false, error: err.message };
        }
    };

    const submitPasswordOnly = async () => {
        if (form.password !== form.confirmPassword) {
            showAlert?.("비밀번호가 일치하지 않습니다.");
            return { success: false };
        }
        if (!form.id) {
            showAlert?.('회원 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
            return { success: false };
        }
        try {
            const dataToSave = {
                ...form
            };
            delete dataToSave.confirmPassword;
            await MemberModel.saveMember(dataToSave);
            showAlert?.('비밀번호가 변경되었습니다.');
            await loadMembers();
            return { success: true };
        } catch (err) {
            showAlert?.('비밀번호 변경 실패: ' + err.message);
            return { success: false, error: err.message };
        }
    };

    const resetForm = () => {
        setForm({
            name: '', password: '', confirmPassword: '', phone: '',
            site_name1: '',
            target_lat: null, target_lng: null,
            radius_m: 500, notes: '', role: 'admin'
        });
    };

    const filteredMembers = members.filter(m =>
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.site_name1 && m.site_name1.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const totalPages = Math.ceil(filteredMembers.length / membersPerPage);
    const indexOfLastMember = currentPage * membersPerPage;
    const indexOfFirstMember = indexOfLastMember - membersPerPage;
    const currentMembers = filteredMembers.slice(indexOfFirstMember, indexOfLastMember);

    const handleEdit = (member) => {
        setForm({
            ...member,
            confirmPassword: member.password
        });
        setViewMode('form');
    };

    const handleBootstrapSiteMember = async () => {
        const selectedSite = sites.find(s => s.id === selectedSiteId);
        if (!selectedSite) {
            showAlert?.('먼저 현장 리스트에서 대상을 선택해 주세요.');
            return { success: false };
        }
        if (!bootstrapMember.name?.trim() || !bootstrapMember.password?.trim()) {
            showAlert?.('회원명과 비밀번호는 필수입니다.');
            return { success: false };
        }

        setIsBootstrappingSiteMember(true);
        try {
            const response = await MemberModel.bootstrapSiteMember({
                site: {
                    id: selectedSite.id,
                    siteName: selectedSite.site_name,
                    managerName: selectedSite.manager_name,
                    method: selectedSite.method,
                    series: selectedSite.series
                },
                member: bootstrapMember,
                link: bootstrapLink,
                syncToBigQuery: true
            });
            await loadMembers();
            await loadSites();
            setBootstrapMember(prev => ({ ...prev, password: '' }));
            showAlert?.(response?.bigQuery?.success
                ? '현장/회원 저장 및 BigQuery 업로드 준비가 완료되었습니다.'
                : '현장/회원은 저장되었고 BigQuery는 점검이 필요합니다.');
            return { success: true };
        } catch (err) {
            showAlert?.('현장/회원 저장 실패: ' + err.message);
            return { success: false, error: err.message };
        } finally {
            setIsBootstrappingSiteMember(false);
        }
    };

    return {
        members: currentMembers,
        allMembersCount: filteredMembers.length,
        loading,
        form,
        updateForm,
        registerCurrentLocation,
        submitForm,
        submitPasswordOnly,
        refresh: loadMembers,
        viewMode,
        setViewMode,
        searchTerm,
        setSearchTerm,
        currentPage,
        setCurrentPage,
        totalPages,
        handleEdit,
        selectedMemberId,
        selectMember,
        newMemberRow,
        setNewMemberRow,
        memberEditMode,
        memberEditRowKey,
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
        setNewSiteRow,
        siteEditMode,
        siteEditRowKey,
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
    };
};
