import React from 'react';
import { useMemberViewModel } from '../viewmodels/useMemberViewModel';

const MemberManagementView = () => {
    const {
        members,
        loading,
        form,
        updateForm,
        registerCurrentLocation,
        submitForm
    } = useMemberViewModel();

    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <header className="mb-8 border-b border-slate-200 pb-4">
                <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                    <span className="material-icons text-corporate-blue">people</span>
                    회원 및 현장 관리
                </h1>
                <p className="text-slate-500 text-sm mt-1">임직원 정보 등록 및 출석 허용 위치(GPS)를 관리합니다.</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 등록 폼 */}
                <section>
                    <div className="glass-card p-6 border-t-4 border-corporate-blue">
                        <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
                            <span className="material-icons text-corporate-blue">person_add</span>
                            신규 회원 등록
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500">성명 *</label>
                                    <input className="form-input w-full" value={form.name} onChange={e => updateForm({ name: e.target.value })} required />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500">비밀번호 *</label>
                                    <input type="password" className="form-input w-full" value={form.password} onChange={e => updateForm({ password: e.target.value })} required />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500">권한 설정</label>
                                <select className="form-input w-full" value={form.role} onChange={e => updateForm({ role: e.target.value })}>
                                    <option value="user">일반 사용자</option>
                                    <option value="admin">관리자 (Admin)</option>
                                </select>
                            </div>

                            <div className="border-t border-slate-100 pt-4">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1">
                                        <span className="material-icons text-sm">location_on</span>
                                        현장 위치 정보 (GPS)
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={registerCurrentLocation}
                                        className="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                                    >
                                        현재 위치 등록
                                    </button>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Latitude (위도)</label>
                                        <input type="number" step="0.000001" className="form-input w-full text-xs" value={form.target_lat} onChange={e => updateForm({ target_lat: parseFloat(e.target.value) })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Longitude (경도)</label>
                                        <input type="number" step="0.000001" className="form-input w-full text-xs" value={form.target_lng} onChange={e => updateForm({ target_lng: parseFloat(e.target.value) })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Radius (허용반경 m)</label>
                                        <input type="number" className="form-input w-full text-xs" value={form.radius_m} onChange={e => updateForm({ radius_m: parseInt(e.target.value) })} />
                                    </div>
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-slate-800 text-white font-bold py-3 rounded-lg hover:bg-slate-700 transition-all shadow-lg active:scale-95">
                                회원 정보 저장 및 동기화
                            </button>
                        </form>
                    </div>
                </section>

                {/* 목록 */}
                <section>
                    <div className="glass-card overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b">
                                <tr>
                                    <th className="px-6 py-4">성명</th>
                                    <th className="px-6 py-4">권한</th>
                                    <th className="px-6 py-4">현장 좌표</th>
                                    <th className="px-6 py-4">반경</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr><td colSpan="4" className="text-center py-8">Loading...</td></tr>
                                ) : members.map(m => (
                                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-slate-800">{m.name}</div>
                                            <div className="text-[10px] text-slate-400">{m.phone || '연락처 없음'}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold ${m.role === 'admin' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-slate-100 text-slate-600'}`}>
                                                {m.role === 'admin' ? '관리자' : '사용자'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-[10px] text-slate-500 font-mono">
                                            {m.target_lat?.toFixed(4)}, {m.target_lng?.toFixed(4)}
                                        </td>
                                        <td className="px-6 py-4 font-bold text-corporate-blue">
                                            {m.radius_m}m
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default MemberManagementView;
