import { useState } from 'react';

// 초기 회원 데이터 (실제 서비스에서는 보안을 위해 외부에서 관리해야 함)
const INITIAL_MEMBERS = [
    { id: 'admin_sys', name: 'admin', pass: '1234' },
    { id: 'admin', name: '김관리', pass: '1234' },
    { id: 'user1', name: '이근무', pass: '1111' },
];

export const useAuthViewModel = () => {
    const [user, setUser] = useState(null);
    const [attendance, setAttendance] = useState([]);

    const login = (name, password) => {
        const member = INITIAL_MEMBERS.find((m) => m.name === name && m.pass === password);
        if (member) {
            const now = new Date();
            const newAttendance = {
                id: member.id,
                date: now.toLocaleDateString(),
                intime: now.toLocaleTimeString(),
                outtime: null,
            };

            setUser(member);
            setAttendance(prev => [...prev, newAttendance]);
            return { success: true, user: member };
        }
        return { success: false, message: '이름 또는 비밀번호가 올바르지 않습니다.' };
    };

    const logout = () => {
        if (user) {
            const now = new Date();
            setAttendance(prev => prev.map(record =>
                (record.id === user.id && record.date === now.toLocaleDateString() && !record.outtime)
                    ? { ...record, outtime: now.toLocaleTimeString() }
                    : record
            ));
        }
        setUser(null);
    };

    const updatePassword = (newPassword) => {
        if (user) {
            // 실제 환경에서는 멤버 리스트 저장 로직 필요
            setUser(prev => ({ ...prev, pass: newPassword }));
            return true;
        }
        return false;
    };

    return {
        user,
        isAuthenticated: !!user,
        login,
        logout,
        updatePassword,
        attendance,
    };
};
