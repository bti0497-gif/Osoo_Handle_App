import { useState, useEffect } from 'react';
import { MemberModel } from '../models/MemberModel';
import { DriveSyncService } from '../services/DriveSyncService';

export const useMemberViewModel = () => {
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'form'
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const membersPerPage = 10;

    const [form, setForm] = useState({
        name: '',
        password: '',
        confirmPassword: '',
        phone: '',
        site_name1: '', // 휴게소명
        method: 'A2O',  // 공법
        target_lat: null,
        target_lng: null,
        radius_m: 500,
        notes: '',
        role: 'admin' // 현장관리자 고정
    });

    useEffect(() => {
        loadMembers();
    }, []);

    const loadMembers = async () => {
        setLoading(true);
        try {
            // 1. 클라우드에서 새로운 회원 정보가 있는지 확인 (시뮬레이션)
            // 실제 구현 시에는 전체 회원 목록을 싱크하는 별도 메서드가 필요할 수 있음

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

    /**
     * 현재 위치 등록 — Windows 위치 서비스 사용 (서버 API 경유)
     */
    const registerCurrentLocation = async () => {
        try {
            const response = await fetch('http://localhost:8901/api/location/current');
            const data = await response.json();

            if (data.success) {
                updateForm({
                    target_lat: data.latitude,
                    target_lng: data.longitude
                });
                alert(`위치 등록 완료\n위도: ${data.latitude.toFixed(6)}\n경도: ${data.longitude.toFixed(6)}`);
            } else {
                alert(data.message || '위치 정보를 가져올 수 없습니다.');
            }
        } catch (err) {
            alert('위치 서비스 연결 실패.\n서버가 실행 중인지 확인해 주세요.');
        }
    };

    const submitForm = async () => {
        try {
            // Map method to site_name2 for DB compatibility
            const dataToSave = {
                ...form,
                site_name2: form.method
            };
            const result = await MemberModel.saveMember(dataToSave);

            // 구글 드라이브에 회원 JSON 동기화 (비동기, 실패해도 무방)
            try {
                await DriveSyncService.uploadMemberJson(dataToSave);
            } catch (syncErr) {
                console.warn("Drive sync failed (non-critical):", syncErr);
            }

            alert("저장 완료");
            await loadMembers();
            resetForm();
            setViewMode('list');
            return { success: true };
        } catch (err) {
            alert("저장 실패: " + err.message);
            return { success: false, error: err.message };
        }
    };

    // 비밀번호만 수정 (일반사용자 전용)
    const submitPasswordOnly = async () => {
        if (!form.id) {
            alert('회원 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
            return { success: false };
        }
        try {
            const dataToSave = {
                ...form,
                site_name2: form.method || form.site_name2
            };
            await MemberModel.saveMember(dataToSave);
            alert('비밀번호가 변경되었습니다.');
            await loadMembers();
            return { success: true };
        } catch (err) {
            alert('비밀번호 변경 실패: ' + err.message);
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

    // Filter and Pagination logic
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
