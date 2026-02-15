import React from 'react';
import { useFlowViewModel } from '../viewmodels/useFlowViewModel';
import PhotoUpload from '../components/PhotoUpload';

const FlowManagementView = ({ currentUser }) => {
    const {
        date,
        setDate,
        readings,
        loading,
        form,
        updateForm,
        submitForm
    } = useFlowViewModel(undefined, currentUser);

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
        <div className="panel-container">
            {/* 메인 입력 패널 */}
            <div className="dynamic-panel shadow-2xl border-slate-200">
                <div className="panel-header bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">유량 가동 검침</h1>
                        <p className="text-slate-500 text-[11px] font-medium">일일 유량 검침값을 기록합니다.</p>
                    </div>
                    <div className="flex items-center gap-2 bg-white border-2 border-slate-800 px-3 py-1 rounded-lg">
                        <span className="material-icons text-slate-400 text-sm">calendar_today</span>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="border-none focus:ring-0 text-xs font-bold outline-none"
                        />
                    </div>
                </div>

                <div className="panel-content">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 gap-6">
                            <div className="space-y-4">
                                <div className="flex items-center gap-4">
                                    <label className="w-24 text-sm font-bold text-slate-600 text-right">검침 항목</label>
                                    <div className="flex-1 relative">
                                        <select
                                            className="w-full border-2 border-slate-800 h-10 px-3 appearance-none focus:border-blue-500 outline-none bg-white font-bold"
                                            value={form.type}
                                            onChange={e => updateForm({ type: e.target.value })}
                                        >
                                            {flowTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                        </select>
                                        <span className="material-icons absolute right-2 top-2 pointer-events-none text-slate-800">arrow_drop_down</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <label className="w-24 text-sm font-bold text-slate-600 text-right font-balance">당일 검침값 (누적)</label>
                                    <input
                                        type="number" step="0.01"
                                        className="flex-1 border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none transition-colors font-mono font-bold text-lg"
                                        value={form.raw_value}
                                        placeholder="0.00"
                                        onChange={e => updateForm({ raw_value: e.target.value })}
                                        disabled={form.is_manual}
                                    />
                                </div>

                                <div className="pl-28 flex gap-8">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={form.is_reset}
                                            onChange={e => updateForm({ is_reset: e.target.checked })}
                                            className="w-4 h-4 border-2 border-slate-800 rounded"
                                        />
                                        <span className="text-xs font-bold text-slate-600 group-hover:text-corporate-blue">검침기 초기화</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={form.is_manual}
                                            onChange={e => updateForm({ is_manual: e.target.checked })}
                                            className="w-4 h-4 border-2 border-slate-800 rounded"
                                        />
                                        <span className="text-xs font-bold text-slate-600 group-hover:text-corporate-blue">유량 직접 수정</span>
                                    </label>
                                </div>

                                {form.is_manual && (
                                    <div className="flex items-center gap-4 animate-fadeIn">
                                        <label className="w-24 text-sm font-bold text-red-500 text-right">수정 유량</label>
                                        <input
                                            type="number" step="0.1"
                                            className="flex-1 border-2 border-red-500 h-10 px-3 outline-none bg-red-50 font-bold"
                                            value={form.manual_flow}
                                            onChange={e => updateForm({ manual_flow: e.target.value })}
                                            required
                                        />
                                    </div>
                                )}

                                <div className="pt-4 border-t border-slate-100 flex gap-6">
                                    <div className="flex-1">
                                        <label className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1">
                                            <span className="material-icons text-[16px]">photo_camera</span>
                                            증빙 사진
                                        </label>
                                        <PhotoUpload
                                            date={date}
                                            type={`flow_${form.type}`}
                                            onUploadSuccess={(path) => console.log("Photo uploaded:", path)}
                                        />
                                    </div>
                                    <div className="flex-1 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                        <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                                            * 사진은 일지 양식에 맞춰 자동 사이즈 조정됩니다. <br />
                                            * 개인정보 보호를 위한 비식별화 처리가 포함됩니다.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-slate-800 text-white font-black py-5 rounded-2xl hover:bg-slate-700 transition-all shadow-xl active:scale-95 text-lg tracking-widest">
                                검침 데이터 저장
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* 현황 목록 패널 */}
            <div className="dynamic-panel flex-1 max-w-[500px] border-slate-200">
                <div className="panel-header bg-slate-50/30">
                    <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                        <span className="material-icons text-corporate-blue">assignment</span>
                        당일 검침 집계
                    </h2>
                </div>
                <div className="panel-content p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b">
                            <tr>
                                <th className="px-6 py-4">항목</th>
                                <th className="px-6 py-4">누적치</th>
                                <th className="px-6 py-4">금일 발생량</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr><td colSpan="3" className="text-center py-12 text-slate-400">Loading...</td></tr>
                            ) : flowTypes.map(type => {
                                const reading = readings.find(r => r.type === type.id);
                                return (
                                    <tr key={type.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 font-bold text-slate-700">{type.label}</td>
                                        <td className="px-6 py-4 text-slate-500 font-mono">
                                            {reading?.raw_value?.toLocaleString() || '-'}
                                            {reading?.is_reset && <span className="ml-2 text-[9px] bg-orange-100 text-orange-600 px-1 rounded">Reset</span>}
                                        </td>
                                        <td className="px-6 py-4 font-black text-corporate-blue text-base">
                                            {reading?.calculated_flow?.toLocaleString() || '-'} <span className="text-[10px] font-bold text-slate-400">㎥</span>
                                            {reading?.is_manual && <span className="ml-1 text-[11px] text-red-400">*</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default FlowManagementView;
