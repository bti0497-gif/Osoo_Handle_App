import React from 'react';
import { useFlowViewModel } from '../viewmodels/useFlowViewModel';
import PhotoUpload from '../components/PhotoUpload';

const FlowManagementView = () => {
    const {
        date,
        setDate,
        readings,
        loading,
        form,
        updateForm,
        submitForm
    } = useFlowViewModel();

    const flowTypes = [
        { id: 'inflow', label: '유입량' },
        { id: 'discharge', label: '방류량' },
        { id: 'return_int', label: '내부반송' },
        { id: 'return_ext', label: '외부반송' },
        { id: 'sludge', label: '잉여슬러지' }
    ];

    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">유량 가동 검침</h1>
                    <p className="text-slate-500 text-sm">일일 유량 검침값을 기록하고 관리합니다.</p>
                </div>
                <div className="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded-lg shadow-sm">
                    <span className="material-icons text-slate-400">calendar_today</span>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="border-none focus:ring-0 text-sm font-semibold"
                    />
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 입력 폼 */}
                <div className="lg:col-span-1">
                    <div className="glass-card p-6 sticky top-6">
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="material-icons text-corporate-blue">edit</span>
                            데이터 입력
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">검침 항목</label>
                                <select
                                    className="form-input w-full"
                                    value={form.type}
                                    onChange={e => updateForm({ type: e.target.value })}
                                >
                                    {flowTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">당일 검침값 (누적)</label>
                                <input
                                    type="number" step="0.01"
                                    className="form-input w-full"
                                    value={form.raw_value}
                                    placeholder="0.00"
                                    onChange={e => updateForm({ raw_value: e.target.value })}
                                    disabled={form.is_manual}
                                />
                            </div>

                            <div className="flex items-center gap-6 py-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.is_reset}
                                        onChange={e => updateForm({ is_reset: e.target.checked })}
                                        className="rounded text-corporate-blue"
                                    />
                                    <span className="text-xs font-semibold text-slate-600">검침기 초기화</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.is_manual}
                                        onChange={e => updateForm({ is_manual: e.target.checked })}
                                        className="rounded text-corporate-blue"
                                    />
                                    <span className="text-xs font-semibold text-slate-600">유량 직접 수정</span>
                                </label>
                            </div>

                            {form.is_manual && (
                                <div className="space-y-1 animate-fadeIn">
                                    <label className="text-xs font-semibold text-red-500">수정할 유량 값</label>
                                    <input
                                        type="number" step="0.1"
                                        className="form-input w-full border-red-200 focus:border-red-500"
                                        value={form.manual_flow}
                                        onChange={e => updateForm({ manual_flow: e.target.value })}
                                        required
                                    />
                                </div>
                            )}

                            <div className="space-y-2 py-4 border-y border-slate-100">
                                <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                                    <span className="material-icons text-[14px]">photo_camera</span>
                                    현장/증빙 사진 (선택)
                                </label>
                                <PhotoUpload
                                    date={date}
                                    type={`flow_${form.type}`}
                                    onUploadSuccess={(path) => console.log("Photo uploaded:", path)}
                                />
                                <p className="text-[10px] text-slate-400 leading-tight">
                                    * 업로드된 사진은 일지 생성 시 지정된 양식 칸에 자동 리사이징되어 삽입됩니다. (보안 가공 처리됨)
                                </p>
                            </div>

                            <div className="pt-4">
                                <button type="submit" className="w-full bg-slate-800 text-white font-bold py-3 rounded-lg hover:bg-slate-700 transition-all shadow-lg active:scale-95">
                                    검침값 저장하기
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* 데이터 테이블 */}
                <div className="lg:col-span-2">
                    <div className="glass-card overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-bottom">
                                <tr>
                                    <th className="px-6 py-4">항목</th>
                                    <th className="px-6 py-4">누적 검침값</th>
                                    <th className="px-6 py-4">당일 유량</th>
                                    <th className="px-6 py-4">비고</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan="4" className="text-center py-8 text-slate-400">불러오는 중...</td>
                                    </tr>
                                ) : flowTypes.map(type => {
                                    const reading = readings.find(r => r.type === type.id);
                                    return (
                                        <tr key={type.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4 font-bold text-slate-700">{type.label}</td>
                                            <td className="px-6 py-4 text-slate-600">
                                                {reading?.raw_value?.toLocaleString() || '-'}
                                                {reading?.is_reset ? <span className="ml-2 badge badge-warning">초기화</span> : ''}
                                            </td>
                                            <td className="px-6 py-4 font-bold text-corporate-blue">
                                                {reading?.calculated_flow?.toLocaleString() || '-'} ㎥
                                                {reading?.is_manual ? <span className="ml-2 text-[10px] text-slate-400">(수동)</span> : ''}
                                            </td>
                                            <td className="px-6 py-4">
                                                {!reading && <span className="text-slate-300 italic text-xs">기록 없음</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FlowManagementView;
