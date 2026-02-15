import React, { useEffect } from 'react';
import { useMemberViewModel } from '../viewmodels/useMemberViewModel';

const MemberManagementView = ({ currentUser, passwordOnly = false }) => {
    const {
        members,
        loading,
        form,
        updateForm,
        registerCurrentLocation,
        submitForm,
        submitPasswordOnly,
        viewMode,
        setViewMode,
        searchTerm,
        setSearchTerm,
        currentPage,
        setCurrentPage,
        totalPages,
        handleEdit,
        allMembersCount
    } = useMemberViewModel();

    // passwordOnly 모드: 진입 시 자기 계정 편집 모드로 자동 전환
    useEffect(() => {
        if (passwordOnly && currentUser) {
            const myMember = members.find(m => m.name === currentUser.name);
            if (myMember) {
                handleEdit(myMember);
            }
        }
    }, [passwordOnly, currentUser, members]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (form.password !== form.confirmPassword) {
            alert("비밀번호가 일치하지 않습니다.");
            return;
        }
        if (passwordOnly) {
            submitPasswordOnly();
        } else {
            submitForm();
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
        <div className="panel-container justify-center">
            <div className="dynamic-panel w-[650px] shadow-2xl border-slate-200">

                {viewMode === 'list' ? (
                    <>
                        {/* ── 고정 상단: 제목 ── */}
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '2px solid #e2e8f0', flexShrink: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em' }}>
                                    회원 및 현장
                                </h1>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>
                                    총 {allMembersCount}명
                                </span>
                            </div>
                        </div>

                        {/* ── 고정 컬럼 헤더 ── */}
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            padding: '0.625rem 1.5rem',
                            backgroundColor: '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                            flexShrink: 0,
                            fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8',
                            textTransform: 'uppercase', letterSpacing: '0.08em'
                        }}>
                            <span style={{ width: '50px', textAlign: 'center' }}>번호</span>
                            <span style={{ flex: 1 }}>이름</span>
                            <span style={{ flex: 1 }}>현장명</span>
                            <span style={{ width: '70px', textAlign: 'center' }}>공법</span>
                        </div>

                        {/* ── 유동 중간: 회원 목록 ── */}
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {loading ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontWeight: 700, fontSize: '0.875rem' }}>
                                    데이터를 불러오는 중...
                                </div>
                            ) : members.length === 0 ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#cbd5e1', fontWeight: 700, fontSize: '0.875rem' }}>
                                    등록된 회원이 없습니다.
                                </div>
                            ) : (
                                <div>
                                    {members.map((m, index) => (
                                        <div
                                            key={m.id}
                                            onClick={() => handleEdit(m)}
                                            style={{
                                                display: 'flex', alignItems: 'center',
                                                padding: '0.4rem 1.5rem',
                                                borderBottom: '1px solid #f1f5f9',
                                                cursor: 'pointer',
                                                transition: 'background-color 0.15s'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0f9ff'}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <span style={{ width: '50px', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 500 }}>
                                                {(currentPage - 1) * 10 + index + 1}
                                            </span>
                                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.8125rem' }}>{m.name}</span>
                                                <span style={{ fontSize: '0.5625rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>
                                                    {m.role === 'admin' ? 'MGR' : 'USR'}
                                                </span>
                                            </div>
                                            <span style={{ flex: 1, fontWeight: 600, color: '#475569', fontSize: '0.8125rem' }}>
                                                {m.site_name1 || '-'}
                                            </span>
                                            <span style={{ width: '70px', textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '0.125rem 0.5rem',
                                                    backgroundColor: '#f1f5f9',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.625rem',
                                                    fontWeight: 900,
                                                    color: '#64748b'
                                                }}>
                                                    {m.site_name2 || 'A2O'}
                                                </span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* ── 고정 하단: 네비게이션 + 검색 + 회원추가 (한 줄) ── */}
                        <div style={{
                            padding: '0.75rem 1.5rem',
                            borderTop: '2px solid #e2e8f0',
                            backgroundColor: '#f8fafc',
                            flexShrink: 0,
                            display: 'flex', alignItems: 'center', gap: '0.75rem'
                        }}>
                            {/* 네비게이션 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                                <button
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(prev => prev - 1)}
                                    style={{
                                        width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        borderRadius: '5px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b',
                                        cursor: currentPage === 1 ? 'default' : 'pointer', opacity: currentPage === 1 ? 0.3 : 1
                                    }}
                                >
                                    <span className="material-icons" style={{ fontSize: '14px' }}>chevron_left</span>
                                </button>
                                {[...Array(Math.max(totalPages, 1))].map((_, i) => (
                                    <button
                                        key={i + 1}
                                        onClick={() => setCurrentPage(i + 1)}
                                        style={{
                                            width: '26px', height: '26px', borderRadius: '5px', border: 'none',
                                            fontWeight: 700, fontSize: '0.6875rem', cursor: 'pointer',
                                            backgroundColor: currentPage === i + 1 ? '#1e293b' : 'transparent',
                                            color: currentPage === i + 1 ? 'white' : '#64748b',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        {i + 1}
                                    </button>
                                ))}
                                <button
                                    disabled={currentPage === totalPages || totalPages === 0}
                                    onClick={() => setCurrentPage(prev => prev + 1)}
                                    style={{
                                        width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        borderRadius: '5px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b',
                                        cursor: (currentPage === totalPages || totalPages === 0) ? 'default' : 'pointer',
                                        opacity: (currentPage === totalPages || totalPages === 0) ? 0.3 : 1
                                    }}
                                >
                                    <span className="material-icons" style={{ fontSize: '14px' }}>chevron_right</span>
                                </button>
                            </div>

                            {/* 검색 */}
                            <div style={{ position: 'relative', width: '180px', flexShrink: 0 }}>
                                <span className="material-icons" style={{
                                    position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                                    color: '#94a3b8', fontSize: '15px'
                                }}>search</span>
                                <input
                                    type="text"
                                    placeholder="검색..."
                                    value={searchTerm}
                                    onChange={e => {
                                        setSearchTerm(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    style={{
                                        width: '100%', height: '32px', paddingLeft: '30px', paddingRight: '8px',
                                        border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '0.75rem',
                                        fontWeight: 600, outline: 'none', backgroundColor: 'white',
                                        transition: 'border-color 0.15s'
                                    }}
                                    onFocus={e => e.target.style.borderColor = '#1e293b'}
                                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                />
                            </div>

                            {/* 스페이서 */}
                            <div style={{ flex: 1 }} />

                            {/* 회원추가 버튼 */}
                            <button
                                onClick={() => {
                                    updateForm({
                                        id: undefined, name: '', password: '', confirmPassword: '', phone: '',
                                        site_name1: '', method: 'A2O', target_lat: null, target_lng: null,
                                        radius_m: 500, notes: '', role: 'admin'
                                    });
                                    setViewMode('form');
                                }}
                                style={{
                                    height: '32px', padding: '0 14px', backgroundColor: '#1e293b', color: 'white',
                                    borderRadius: '6px', border: 'none', fontWeight: 700, fontSize: '0.75rem',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                                    whiteSpace: 'nowrap', transition: 'background-color 0.15s', flexShrink: 0
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#334155'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#1e293b'}
                            >
                                <span className="material-icons" style={{ fontSize: '14px' }}>add</span>
                                회원추가
                            </button>
                        </div>

                    </>
                ) : (
                    /* ── 등록/수정 모드 ── */
                    <>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '2px solid #e2e8f0', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em' }}>
                                {form.id ? '회원 정보 수정' : '신규 회원 등록'}
                            </h1>
                            <button
                                onClick={() => setViewMode('list')}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: '0.8125rem', fontWeight: 700, color: '#94a3b8',
                                    transition: 'color 0.15s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = '#1e293b'}
                                onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                            >
                                <span className="material-icons" style={{ fontSize: '16px' }}>arrow_back</span>
                                목록으로
                            </button>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem 1.5rem' }}>
                            <form onSubmit={handleSubmit}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>이름</label>
                                            <input
                                                style={{ width: '100%', border: '2px solid #1e293b', height: '40px', padding: '0 12px', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                                value={form.name}
                                                onChange={e => updateForm({ name: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>비밀번호</label>
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
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>회원 종류</label>
                                            <div
                                                style={{ width: '100%', border: '2px solid #e2e8f0', height: '40px', padding: '0 12px', fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', backgroundColor: '#f8fafc' }}
                                            >
                                                현장관리자
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>휴게소명</label>
                                            <input
                                                style={{ width: '100%', border: '2px solid #1e293b', height: '40px', padding: '0 12px', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                                value={form.site_name1}
                                                onChange={e => updateForm({ site_name1: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>공법</label>
                                            <select
                                                style={{ width: '100%', border: '2px solid #1e293b', height: '40px', padding: '0 12px', fontWeight: 700, color: '#1e293b', outline: 'none', backgroundColor: 'white', appearance: 'none' }}
                                                value={form.method}
                                                onChange={e => updateForm({ method: e.target.value })}
                                            >
                                                <option value="A2O">A2O</option>
                                                <option value="MBR">MBR</option>
                                                <option value="SBR">SBR</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>허용반경 (m)</label>
                                            <input
                                                type="number"
                                                style={{ width: '100%', border: '2px solid #e2e8f0', height: '40px', padding: '0 12px', fontWeight: 700, color: '#64748b', outline: 'none', backgroundColor: '#f8fafc' }}
                                                value={form.radius_m}
                                                readOnly
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>위치 등록</label>
                                            <button
                                                type="button"
                                                onClick={registerCurrentLocation}
                                                style={{
                                                    width: '100%', height: '40px', border: '1.5px solid ' + (form.target_lat ? '#22c55e' : '#cbd5e1'),
                                                    borderRadius: '0', backgroundColor: form.target_lat ? '#f0fdf4' : '#f8fafc', fontWeight: 700,
                                                    color: form.target_lat ? '#16a34a' : '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center',
                                                    justifyContent: 'center', gap: '6px', fontSize: '0.8125rem'
                                                }}
                                            >
                                                <span className="material-icons" style={{ fontSize: '16px' }}>
                                                    {form.target_lat ? 'check_circle' : 'my_location'}
                                                </span>
                                                {form.target_lat ? '위치 등록 완료' : '현재위치 등록'}
                                            </button>
                                        </div>

                                    </div>
                                </div>

                                {/* 하단 버튼 */}
                                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '0.75rem' }}>
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('list')}
                                        style={{
                                            flex: 1, height: '48px', borderRadius: '12px', border: '2px solid #e2e8f0',
                                            background: 'white', fontWeight: 900, color: '#94a3b8', cursor: 'pointer',
                                            fontSize: '0.875rem', transition: 'all 0.15s'
                                        }}
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="submit"
                                        style={{
                                            flex: 2, height: '48px', borderRadius: '12px', border: 'none',
                                            backgroundColor: '#1e293b', color: 'white', fontWeight: 900,
                                            fontSize: '1rem', cursor: 'pointer', transition: 'all 0.15s',
                                            boxShadow: '0 4px 12px rgba(30,41,59,0.2)'
                                        }}
                                    >
                                        데이터 저장하기
                                    </button>
                                </div>
                            </form>
                        </div>
                    </>
                )}

            </div>
        </div>
    );
};

export default MemberManagementView;
