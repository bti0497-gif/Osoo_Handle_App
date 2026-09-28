import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AuthModel } from './AuthModel';

const LoginView = ({ onLogin, loginHintName = '' }) => {
    const [name, setName] = useState(() => String(loginHintName || localStorage.getItem('lastLoginName') || '').trim());
    const [pass, setPass] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [isRemoteBlocked, setIsRemoteBlocked] = useState(false);

    const nameRef = useRef(null);
    const passRef = useRef(null);
    const hasEditedNameRef = useRef(false);
    const restoringFocusRef = useRef(false);
    const isRemoteBlockedRef = useRef(false);
    const inputResetCountRef = useRef(0);
    const lastInputResetTriggerRef = useRef('none');
    const lastInputResetAtRef = useRef(0);
    const lastInputEditAtRef = useRef(0);
    const lastWindowFocusAtRef = useRef(0);
    const submitSequenceRef = useRef(0);

    const checkRemote = useCallback(async (currentName) => {
        const targetName = String(currentName !== undefined ? currentName : name || '').trim();
        const isAdmin = targetName.toLowerCase() === 'admin';
        try {
            const remote = await AuthModel.getRemoteStatus();
            if (remote?.detected && !isAdmin) {
                setIsRemoteBlocked(true);
                isRemoteBlockedRef.current = true;
                setPass('');
                setError('원격 시도는 차단되어 있습니다..');
            } else {
                if (isRemoteBlockedRef.current) {
                    setIsRemoteBlocked(false);
                    isRemoteBlockedRef.current = false;
                    setError((prev) => prev === '원격 시도는 차단되어 있습니다..' ? '' : prev);
                }
            }
        } catch (e) {
            console.warn('[LoginView] 원격 상태 점검 실패:', e);
        }
    }, [name]);

    useEffect(() => {
        const hasPrefilledName = Boolean(nameRef.current?.value);
        window.focus();
        const timer = window.setTimeout(() => {
            (hasPrefilledName ? passRef.current : nameRef.current)?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        void checkRemote();
        const intervalId = window.setInterval(() => {
            void checkRemote();
        }, 5000);
        return () => window.clearInterval(intervalId);
    }, [checkRemote]);

    useEffect(() => {
        const restoreInputFocus = (trigger = 'electron-restored') => {
            lastWindowFocusAtRef.current = Date.now();
            if (restoringFocusRef.current) return;
            restoringFocusRef.current = true;
            inputResetCountRef.current += 1;
            lastInputResetTriggerRef.current = trigger;
            lastInputResetAtRef.current = Date.now();
            // A restored login window is a fresh authentication attempt.
            // Never carry a password or an old rejection across tray/app restore.
            setPass('');
            setError('');
            void checkRemote();
            window.focus();
            window.requestAnimationFrame(() => {
                const active = document.activeElement;
                const activeIsLoginInput = active === nameRef.current || active === passRef.current;
                const target = activeIsLoginInput
                    ? active
                    : (nameRef.current?.value ? passRef.current : nameRef.current);
                target?.focus({ preventScroll: true });
                restoringFocusRef.current = false;
            });
        };

        const unsubscribe = window.electronAPI?.onWindowRestored?.(() => restoreInputFocus('electron-restored'));
        const handleWindowFocus = () => restoreInputFocus('window-focus');
        window.addEventListener('focus', handleWindowFocus);

        return () => {
            window.removeEventListener('focus', handleWindowFocus);
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [checkRemote]);

    useEffect(() => {
        const nextName = String(loginHintName || '').trim();
        if (!nextName) return;
        const timer = setTimeout(() => {
            if (hasEditedNameRef.current) {
                return;
            }
            setName(nextName);
            setPass('');
            setError('');
            void checkRemote(nextName);
            passRef.current?.focus();
        }, 0);
        return () => clearTimeout(timer);
    }, [loginHintName, checkRemote]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting) return;
        if (isRemoteBlocked && name.trim().toLowerCase() !== 'admin') {
            setError('원격 시도는 차단되어 있습니다..');
            setPass('');
            await AuthModel.reportRemoteAttempt(name || loginHintName);
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            const submittedAt = Date.now();
            const submitSequence = submitSequenceRef.current + 1;
            submitSequenceRef.current = submitSequence;
            const ageSince = (timestamp) => timestamp > 0
                ? Math.max(0, submittedAt - timestamp)
                : null;
            const nativeInput = String(passRef.current?.value || '');
            const stateInput = String(pass || '');
            const result = await onLogin(name, nativeInput, {
                loginAttemptId: `${submittedAt.toString(36)}-${submitSequence}`,
                submitSequence,
                inputSource: 'native-field',
                clientStateLength: stateInput.length,
                nativeFieldLength: nativeInput.length,
                stateMatchesNative: stateInput === nativeInput,
                windowFocused: document.hasFocus(),
                inputResetCount: inputResetCountRef.current,
                lastInputResetTrigger: lastInputResetTriggerRef.current,
                lastInputEditAgeMs: ageSince(lastInputEditAtRef.current),
                lastInputResetAgeMs: ageSince(lastInputResetAtRef.current),
                lastWindowFocusAgeMs: ageSince(lastWindowFocusAtRef.current),
            });
            if (result.success) {
                localStorage.setItem('lastLoginName', name);
            } else {
                if (result.code === 'REMOTE_LOGIN_BLOCKED' || result.message === '원격 시도는 차단되어 있습니다..') {
                    setIsRemoteBlocked(true);
                    isRemoteBlockedRef.current = true;
                }
                setError(result.message || '이름 또는 비밀번호를 다시 확인해 주세요.');
                // Never retain a hidden stale value after a rejected login.
                setPass('');
                window.requestAnimationFrame(() => passRef.current?.focus());
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-header-new" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                    <img src="./logo.png" alt="Logo" style={{ width: '50px', height: 'auto' }} />
                    <h1 className="login-title-main" style={{ textAlign: 'left' }}>
                        더죤환경기술(주)<br />
                        <span className="login-title-sub">오수처리 통합관리시스템</span>
                    </h1>
                </div>

                <form onSubmit={handleSubmit} className="login-form-new">
                    <div className="input-wrapper-new">
                        <span className="material-symbols-outlined input-icon-new">person</span>
                        <input
                            type="text"
                            className="form-input-new"
                            placeholder="이름"
                            value={name}
                            ref={nameRef}
                            onPointerDown={() => window.focus()}
                            onChange={(e) => {
                                hasEditedNameRef.current = true;
                                const nextVal = e.target.value;
                                setName(nextVal);
                                void checkRemote(nextVal);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && passRef.current) {
                                    e.preventDefault();
                                    passRef.current.focus();
                                }
                            }}
                            required
                        />
                    </div>

                    <div className="input-wrapper-new">
                        <span className="material-symbols-outlined input-icon-new">lock</span>
                        <input
                            type="password"
                            autoComplete="current-password"
                            autoCapitalize="none"
                            spellCheck={false}
                            className="form-input-new"
                            placeholder={isRemoteBlocked && name.trim().toLowerCase() !== 'admin' ? '원격 시도는 차단되어 있습니다..' : '비밀번호'}
                            value={isRemoteBlocked && name.trim().toLowerCase() !== 'admin' ? '' : pass}
                            ref={passRef}
                            disabled={isRemoteBlocked && name.trim().toLowerCase() !== 'admin'}
                            onPointerDown={() => {
                                window.focus();
                                if (isRemoteBlocked && name.trim().toLowerCase() !== 'admin') {
                                    setError('원격 시도는 차단되어 있습니다..');
                                    setPass('');
                                } else {
                                    void checkRemote();
                                }
                            }}
                            onFocus={() => {
                                if (isRemoteBlocked && name.trim().toLowerCase() !== 'admin') {
                                    setError('원격 시도는 차단되어 있습니다..');
                                    setPass('');
                                    passRef.current?.blur();
                                } else {
                                    void checkRemote();
                                }
                            }}
                            onChange={(e) => {
                                if (isRemoteBlocked && name.trim().toLowerCase() !== 'admin') {
                                    setPass('');
                                    setError('원격 시도는 차단되어 있습니다..');
                                    return;
                                }
                                lastInputEditAtRef.current = Date.now();
                                setPass(e.target.value);
                            }}
                            autoFocus
                            required
                        />
                    </div>

                    {isRemoteBlocked && name.trim().toLowerCase() !== 'admin' && (
                        <div style={{
                            backgroundColor: '#fef2f2',
                            border: '1px solid #f87171',
                            borderRadius: '8px',
                            padding: '0.625rem 0.875rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            color: '#b91c1c',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            lineHeight: 1.3,
                        }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#dc2626' }}>
                                block
                            </span>
                            <span>원격 시도는 차단되어 있습니다..</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn-login-new"
                        disabled={submitting}
                        style={isRemoteBlocked && name.trim().toLowerCase() !== 'admin' ? { opacity: 0.65 } : {}}
                    >
                        {submitting ? '로그인 확인 중…' : isRemoteBlocked && name.trim().toLowerCase() !== 'admin' ? '원격 차단됨' : '로그인'}
                    </button>

                    {error && (
                        <div role="alert" style={{ color: '#dc2626', fontSize: '0.9rem', fontWeight: 700, marginTop: '0.75rem', textAlign: 'center' }}>
                            {error}
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};

export default LoginView;
