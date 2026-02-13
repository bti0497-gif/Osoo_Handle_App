import { useState, useEffect } from 'react';
import { MemberModel } from '../models/MemberModel';

export const useMemberViewModel = () => {
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        name: '',
        password: '',
        phone: '',
        site_name1: '',
        site_name2: '',
        target_lat: 37.5665,
        target_lng: 126.9780,
        radius_m: 500,
        notes: '',
        role: 'user'
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

    const registerCurrentLocation = () => {
        if (!navigator.geolocation) {
            alert("브라우저가 위치 정보를 지원하지 않습니다.");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                updateForm({
                    target_lat: pos.coords.latitude,
                    target_lng: pos.coords.longitude
                });
                alert("현재 위치 정보가 폼에 반영되었습니다.");
            },
            (err) => alert("위치 정보를 가져올 수 없습니다: " + err.message)
        );
    };

    const submitForm = async () => {
        try {
            await MemberModel.saveMember(form);
            alert("회원 등록 완료 (Cloud 동기화 시작됨)");
            await loadMembers();
            setForm({
                name: '', password: '', phone: '',
                site_name1: '', site_name2: '',
                target_lat: 37.5665, target_lng: 126.9780,
                radius_m: 500, notes: '', role: 'user'
            });
            return { success: true };
        } catch (err) {
            alert("저장 실패: " + err.message);
            return { success: false, error: err.message };
        }
    };

    return {
        members,
        loading,
        form,
        updateForm,
        registerCurrentLocation,
        submitForm,
        refresh: loadMembers
    };
};
