import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ROADWORK_RESTORE_STATUS_SCRIPT,
    buildRoadworkHistoryListScript,
    buildRoadworkHistoryPreviewScript,
} from './roadworkHistoryScripts';
import './HistoryRestoreModal.css';
import { SettingsModel } from '../SettingsModel';
import { FlowModel } from '../../flow/FlowModel';
import { MedicineModel } from '../../medicine/MedicineModel';
import { KitModel } from '../../kit/KitModel';

const DEFAULT_ROADWORK_URL = 'https://nwpo.ex.co.kr:5002/security/login.do';

export default function HistoryRestoreModal({ open, onClose }) {
    const webviewRef = useRef(null);
    const previewCancelledRef = useRef(false);
    const [preloadPath, setPreloadPath] = useState('');
    const [webviewUrl, setWebviewUrl] = useState('');
    const [status, setStatus] = useState({ authenticated: false, dailyScreenReady: false, reason: 'loading' });
    const [isChecking, setIsChecking] = useState(false);
    const [isQuerying, setIsQuerying] = useState(false);
    const [isBuildingPreview, setIsBuildingPreview] = useState(false);
    const [listResult, setListResult] = useState(null);
    const [previewResult, setPreviewResult] = useState(null);
    const [inspectionResult, setInspectionResult] = useState(null);
    const [isInspecting, setIsInspecting] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [applyResult, setApplyResult] = useState(null);
    const [showPreviewGrid, setShowPreviewGrid] = useState(false);
    const [detailProgress, setDetailProgress] = useState({ current: 0, total: 0 });
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        (async () => {
            try {
                const resolvedPreload = await window.electronAPI?.invokeRoadwork?.('roadwork:getPreloadPath');
                const urlResult = await window.electronAPI?.invokeRoadwork?.('roadwork:getRoadworkUrl');
                if (cancelled) return;
                setPreloadPath(resolvedPreload || '');
                setWebviewUrl(String(urlResult?.url || DEFAULT_ROADWORK_URL).replace(':5002//security', ':5002/security'));
            } catch {
                if (!cancelled) setWebviewUrl(DEFAULT_ROADWORK_URL);
            }
        })();
        return () => { cancelled = true; };
    }, [open]);

    const checkScreen = useCallback(async () => {
        const webview = webviewRef.current;
        if (!webview || isChecking) return;
        setIsChecking(true);
        try {
            const result = await webview.executeJavaScript(ROADWORK_RESTORE_STATUS_SCRIPT);
            setStatus(result || { authenticated: false, dailyScreenReady: false, reason: 'unknown' });
            if (result?.dailyScreenReady) {
                const handlers = result.handlerNames?.length ? result.handlerNames.join(', ') : '없음';
                const methods = result.gridSelectionMethods?.length ? result.gridSelectionMethods.join(', ') : '없음';
                setMessage(`화면 확인 완료 · 이벤트: ${handlers} · 선택 API: ${methods} · 첫 셀: ${result.firstCellId || '없음'}`);
            }
            else if (!result?.authenticated) setMessage('공사입력 도우미에서 로그인과 이중 인증을 먼저 완료해 주세요.');
            else setMessage('아래 도로공사 화면에서 일일업무 조회 목록을 열어주세요.');
        } catch (error) {
            setMessage(error?.message || '도로공사 화면 상태를 확인하지 못했습니다.');
        } finally {
            setIsChecking(false);
        }
    }, [isChecking]);

    const queryPeriod = useCallback(async () => {
        const webview = webviewRef.current;
        if (!webview || !status.dailyScreenReady || isQuerying) return;
        setIsQuerying(true);
        setListResult(null);
        setPreviewResult(null);
        setInspectionResult(null);
        setShowPreviewGrid(false);
        setMessage('도로공사 기간 목록을 조회하는 중입니다.');
        try {
            const result = await webview.executeJavaScript(buildRoadworkHistoryListScript());
            setListResult(result);
            setMessage(result?.success
                ? `조회 목록 ${result.count || 0}건을 확인했습니다. 아직 로컬 DB에는 저장하지 않았습니다.`
                : result?.message || '기간 조회에 실패했습니다.');
        } catch (error) {
            setMessage(error?.message || '기간 조회 중 오류가 발생했습니다.');
        } finally {
            setIsQuerying(false);
        }
    }, [isQuerying, status.dailyScreenReady]);

    const buildPreview = useCallback(async () => {
        const webview = webviewRef.current;
        if (!webview || !listResult?.success || isBuildingPreview) return;
        previewCancelledRef.current = false;
        setIsBuildingPreview(true);
        setPreviewResult(null);
        setInspectionResult(null);
        setDetailProgress({ current: 0, total: listResult.count || 0 });
        setMessage(`상세자료 ${listResult.count || 0}건을 한 건씩 천천히 읽습니다. 도로공사 화면을 조작하지 마세요.`);
        try {
            const documents = [];
            const errors = [];
            const rows = listResult.rows || [];
            for (let index = 0; index < rows.length; index += 1) {
                if (previewCancelledRef.current) break;
                setDetailProgress({ current: index + 1, total: rows.length });
                setMessage(`상세 요청 중 ${index + 1}/${rows.length}${rows[index]?.registeredAt ? ` · ${rows[index].registeredAt}` : ''}`);
                const partial = await webview.executeJavaScript(buildRoadworkHistoryPreviewScript([rows[index]]));
                if (partial?.documents?.length) documents.push(...partial.documents);
                if (partial?.errors?.length) errors.push(...partial.errors);
                if (partial?.fatal) {
                    const failure = partial.errors?.[0] || {};
                    setPreviewResult({
                        success: documents.length > 0,
                        count: documents.length,
                        documents,
                        errors,
                        cancelled: true,
                        fatal: partial.fatal,
                    });
                    setMessage(
                        `상세 응답 실패(${partial.fatal}) · 목표문서 ${failure.targetDocumentKey || '-'}`
                        + ` · 전→후 문서 ${failure.beforeDocumentKey || '-'}→${failure.afterDocumentKey || '-'}`
                        + ` · 전→후 날짜 ${failure.beforeDate || '-'}→${failure.afterDate || '-'}`
                    );
                    return;
                }
                if (index < rows.length - 1 && !previewCancelledRef.current) {
                    const isBatchBoundary = (index + 1) % 5 === 0;
                    if (isBatchBoundary) {
                        setMessage(`상세 ${index + 1}/${rows.length}건 완료 · 도로공사 서버 보호를 위해 10초 대기 후 자동으로 계속합니다.`);
                    }
                    const delay = isBatchBoundary ? 10000 : 5000;
                    await new Promise((resolve) => window.setTimeout(resolve, delay));
                }
            }
            if (previewCancelledRef.current) {
                setPreviewResult({ success: documents.length > 0, count: documents.length, documents, errors, cancelled: true });
                setMessage(`상세 읽기를 ${documents.length}/${rows.length}건에서 중단했습니다. 저장된 데이터는 없습니다.`);
                return;
            }
            const result = { success: documents.length > 0, count: documents.length, documents, errors };
            if (!result?.success) {
                setPreviewResult(result);
                setMessage(result?.message || '상세자료를 읽지 못했습니다.');
                return;
            }
            setPreviewResult(result);
            setMessage(`상세자료 ${result.count || 0}일을 읽었습니다. 복원 미리보기를 눌러 항목 매칭과 기존 데이터 충돌을 확인하세요.`);
        } catch (error) {
            setMessage(error?.message || '상세자료 미리보기 중 오류가 발생했습니다.');
        } finally {
            setIsBuildingPreview(false);
        }
    }, [isBuildingPreview, listResult]);

    const inspectPreview = useCallback(async () => {
        if (!previewResult?.success || isInspecting) return;
        setIsInspecting(true);
        setInspectionResult(null);
        setMessage('복원 항목 매칭과 기존 로컬 데이터 충돌을 확인하는 중입니다.');
        try {
            const inspection = await SettingsModel.inspectRoadworkHistoryRestore(previewResult.documents || []);
            setInspectionResult(inspection);
            setShowPreviewGrid(Boolean(inspection?.success));
            setMessage(inspection?.success
                ? `미리보기 완료 · 상세 ${inspection.documentCount || 0}일 · 유량 ${inspection.flowRows || 0}건 · 약품 ${inspection.medicineRows || 0}건 · 키트 ${inspection.kitRows || 0}건 · 기존 데이터 ${inspection.existingRows || 0}건`
                : inspection?.message || '복원 미리보기를 만들지 못했습니다.');
        } catch (error) {
            setMessage(`${error?.message || '복원 미리보기 실패'} · 개발서버의 백엔드 재시작이 필요할 수 있습니다.`);
        } finally {
            setIsInspecting(false);
        }
    }, [isInspecting, previewResult]);

    const applyPreview = useCallback(async () => {
        if (!inspectionResult?.success || !previewResult?.success || isApplying || applyResult?.success) return;
        const confirmed = window.confirm(
            '현재 로컬 DB를 먼저 백업한 뒤 과거자료를 복원합니다.\n'
            + '기존 데이터는 덮어쓰지 않고, 누락된 날짜만 보완합니다.\n\n계속하시겠습니까?'
        );
        if (!confirmed) return;
        setIsApplying(true);
        setApplyResult(null);
        setMessage('로컬 DB 백업 후 복원·보완·연속성 검증을 진행하고 있습니다.');
        try {
            const result = await SettingsModel.applyRoadworkHistoryRestore(previewResult.documents || []);
            FlowModel.clearHistoryCache();
            MedicineModel.clearHistoryCache();
            KitModel.clearHistoryCache();
            setApplyResult(result);
            const stats = result?.stats || {};
            setMessage(
                `복원 및 검증 완료 · 유량 ${stats.flowInserted || 0}건 · 약품 ${stats.medicineInserted || 0}건`
                + ` · 키트 ${stats.kitInserted || 0}건 · 기존 데이터 보호 ${stats.protectedExisting || 0}건`
                + ` · 도로공사 원본 덮어쓰기 ${stats.sourceRowsOverwritten || 0}건`
                + (stats.correctedClassificationRows ? ` · 키트 오분류 정정 ${stats.correctedClassificationRows}건` : '')
                + ` · 빈 날짜 보완 ${stats.complementedDates || 0}일`
                + (stats.flowRowsWithoutReading ? ` · 검침값 없는 유량 ${stats.flowRowsWithoutReading}건` : '')
            );
        } catch (error) {
            setMessage(error?.message || '로컬 DB 복원 및 검증에 실패했습니다. 변경 내용은 저장되지 않았습니다.');
        } finally {
            setIsApplying(false);
        }
    }, [applyResult?.success, inspectionResult?.success, isApplying, previewResult]);

    const formatNumber = (value) => {
        if (value === null || value === undefined || String(value).trim() === '') return '-';
        const number = Number(String(value).replace(/,/g, ''));
        return Number.isFinite(number) ? number.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : String(value);
    };

    const formatFlowPreview = (rows = []) => rows.map((row) => {
        const name = row?.insrIdntIdText || row?.dwrmWeihgInsrCd || '항목';
        return `${name}: ${formatNumber(row?.tdayDrwtMsrmVal)} / ${formatNumber(row?.drwtProsAmnt)}`;
    }).join('\n') || '-';

    const formatInventoryPreview = (rows = []) => rows.map((row) => {
        const name = row?.chmcText || row?.chmcClssNmText || row?.column29 || '항목';
        return `${name}: 입 ${formatNumber(row?.chmcPuchAmnt)} · 사 ${formatNumber(row?.chmcUseAmnt)} · 잔 ${formatNumber(row?.chmcRsqnVal)}`;
    }).join('\n') || '-';

    const cancelPreview = useCallback(() => {
        previewCancelledRef.current = true;
        setMessage('현재 상세 응답이 끝나면 읽기를 중단합니다.');
    }, []);

    if (!open) return null;

    return (
        <div className="history-restore-backdrop" role="presentation">
            <section className="history-restore-modal" role="dialog" aria-modal="true" aria-label="과거자료 복원">
                <header>
                    <div>
                        <h2>과거자료 복원</h2>
                        <p>공사입력 도우미에서 인증한 세션으로 도로공사 자료를 읽습니다.</p>
                    </div>
                    <button type="button" className="history-restore-close" onClick={onClose} aria-label="닫기">×</button>
                </header>

                <div className="history-restore-toolbar">
                    <button type="button" onClick={checkScreen} disabled={isChecking || !webviewUrl}>
                        {isChecking ? '확인 중...' : '세션·화면 확인'}
                    </button>
                    <button type="button" onClick={queryPeriod} disabled={!status.dailyScreenReady || isQuerying}>
                        {isQuerying ? '읽는 중...' : '현재 조회목록 읽기'}
                    </button>
                </div>

                <div className={`history-restore-status ${status.dailyScreenReady ? 'ready' : ''}`}>
                    {message || '도로공사 화면이 열린 뒤 세션·화면 확인을 눌러주세요.'}
                </div>

                {showPreviewGrid ? (
                    <div className="history-restore-preview-backdrop" role="presentation">
                        <div className="history-restore-preview" role="dialog" aria-modal="true" aria-label="복원 미리보기">
                            <div className="history-restore-preview-header">
                                <div>
                                    <h3>복원 미리보기</h3>
                                    <p>날짜별 도로공사 원본입니다. 아직 로컬 DB에 저장하지 않았습니다.</p>
                                </div>
                                <button type="button" onClick={() => setShowPreviewGrid(false)}>미리보기 닫기</button>
                            </div>
                            <div className="history-restore-preview-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>날짜</th>
                                            <th>유량 · 금일검침 / 사용량</th>
                                            <th>전력 · 금일검침 / 사용량</th>
                                            <th>약품·키트 · 입고 / 사용 / 잔고</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(previewResult?.documents || []).map((document, index) => (
                                            <tr key={`${document.date}-${document.documentKey || index}`}>
                                                <td>{document.date || '-'}</td>
                                                <td><pre>{formatFlowPreview(document.flow)}</pre></td>
                                                <td>
                                                    <pre>
                                                        {`${formatNumber(document.electricity?.todayReading)} / ${formatNumber(document.electricity?.usage)}`}
                                                    </pre>
                                                </td>
                                                <td><pre>{formatInventoryPreview(document.chemicals)}</pre></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : null}
                <div className="history-restore-content">
                    <div className="history-restore-browser">
                        {webviewUrl ? (
                            <webview
                                ref={webviewRef}
                                src={webviewUrl}
                                partition="persist:osoo-roadwork"
                                preload={preloadPath || undefined}
                                nodeintegration="false"
                                enableremotemodule="false"
                                allowpopups="true"
                            />
                        ) : <div className="history-restore-loading">도로공사 화면 준비 중...</div>}
                    </div>
                    <aside>
                        <h3>조회 결과</h3>
                        <strong>{listResult?.success ? `${listResult.count || 0}건` : '조회 전'}</strong>
                        <p>
                            {isBuildingPreview
                                ? `상세 읽기 ${detailProgress.current}/${detailProgress.total}`
                                : previewResult?.success
                                ? `상세 ${previewResult.count || 0}일 · 오류 ${previewResult.errors?.length || 0}건`
                                : '목록 확인 후 상세자료 미리보기를 생성합니다.'}
                        </p>
                        <button
                            type="button"
                            onClick={buildPreview}
                            disabled={!listResult?.success || isBuildingPreview || Boolean(previewResult?.success && !previewResult?.cancelled)}
                        >
                            {isBuildingPreview
                                ? `상세 읽기 ${detailProgress.current}/${detailProgress.total}`
                                : previewResult?.success && !previewResult?.cancelled
                                    ? '상세 읽기 완료'
                                    : '상세자료 천천히 읽기'}
                        </button>
                        {isBuildingPreview ? (
                            <button type="button" className="history-restore-cancel" onClick={cancelPreview}>읽기 중단</button>
                        ) : null}
                        <button
                            type="button"
                            onClick={inspectPreview}
                            disabled={!previewResult?.success || previewResult?.cancelled || isInspecting}
                        >
                            {isInspecting ? '미리보기 생성 중...' : inspectionResult?.success ? '복원 미리보기 완료' : '복원 미리보기'}
                        </button>
                        {inspectionResult?.success ? (
                            <button type="button" onClick={() => setShowPreviewGrid(true)}>미리보기 그리드 보기</button>
                        ) : null}
                        <button
                            type="button"
                            onClick={applyPreview}
                            disabled={!inspectionResult?.success || isApplying || Boolean(applyResult?.success)}
                        >
                            {isApplying ? '복원·검증 중...' : applyResult?.success ? '복원·검증 완료' : '로컬 DB 복원'}
                        </button>
                    </aside>
                </div>
            </section>
        </div>
    );
}
