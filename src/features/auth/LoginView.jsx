import React, { useState, useRef } from 'react';
import { useEffect } from 'react';

const LoginView = ({ onLogin, loginHintName = '' }) => {
    const [name, setName] = useState(() => String(loginHintName || localStorage.getItem('lastLoginName') || '').trim());
    const [pass, setPass] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const nameRef = useRef(null);
    const passRef = useRef(null);
    const hasEditedNameRef = useRef(false);
    const restoringFocusRef = useRef(false);
    const inputResetCountRef = useRef(0);
    const lastInputResetTriggerRef = useRef('none');
    const lastInputResetAtRef = useRef(0);
    const lastInputEditAtRef = useRef(0);
    const lastWindowFocusAtRef = useRef(0);
    const submitSequenceRef = useRef(0);

    useEffect(() => {
        const hasPrefilledName = Boolean(nameRef.current?.value);
        window.focus();
        const timer = window.setTimeout(() => {
            (hasPrefilledName ? passRef.current : nameRef.current)?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

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
    }, []);

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
            passRef.current?.focus();
        }, 0);
        return () => clearTimeout(timer);
    }, [loginHintName]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting) return;
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
                                setName(e.target.value);
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
                            placeholder="비밀번호"
                            value={pass}
                            ref={passRef}
                            onPointerDown={() => window.focus()}
                            onChange={(e) => {
                                lastInputEditAtRef.current = Date.now();
                                setPass(e.target.value);
                            }}
                            autoFocus
                            required
                        />
                    </div>

                    <button type="submit" className="btn-login-new" disabled={submitting}>
                        {submitting ? '로그인 확인 중…' : '로그인'}
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
