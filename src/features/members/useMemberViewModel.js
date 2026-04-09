import { useState, useEffect } from 'react';
import { MemberModel } from './MemberModel';
import { apiClient } from '../../core/api';
import { SyncService } from '../auth/SyncService';

export const useMemberViewModel = ({ showAlert, showConfirm } = {}) => {
    const [members, setMembers] = useState([]);
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
        method: 'A2O',
        target_lat: null,
        target_lng: null,
        radius_m: 500,
        notes: '',
        role: 'admin'
    });

    useEffect(() => {
        loadMembers();
    }, []);

    const loadMembers = async () => {
        setLoading(true);
        try {
            const data = await MemberModel.fetchMembers();
            setMembers(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
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
        } catch (err) {
            showAlert?.('위치 서비스 연결 실패.\n서버가 실행 중인지 확인해 주세요.');
        }
    };

    const submitForm = async () => {
        if (form.password !== form.confirmPassword) {
            showAlert?.("비밀번호가 일치하지 않습니다.");
            return { success: false };
        }
        try {
            const { confirmPassword, method, ...rest } = form;
            const dataToSave = {
                ...rest,
                site_name2: method || form.site_name2
            };

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
            const { confirmPassword, method, ...rest } = form;
            const dataToSave = {
                ...rest,
                site_name2: method || form.site_name2
            };
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
            site_name1: '', method: 'A2O',
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
            confirmPassword: member.password,
            method: member.site_name2 || 'A2O'
        });
        setViewMode('form');
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
        handleEdit
    };
};
