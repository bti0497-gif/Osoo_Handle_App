import React, { useState, useRef } from 'react';
import { useEffect } from 'react';

const LoginView = ({ onLogin, loginHintName = '' }) => {
    const [name, setName] = useState(() => String(loginHintName || localStorage.getItem('lastLoginName') || '').trim());
    const [pass, setPass] = useState('');
    const [error, setError] = useState('');

    const nameRef = useRef(null);
    const passRef = useRef(null);
    const hasEditedNameRef = useRef(false);
    const mountedAtRef = useRef(null);
    const recordedEventsRef = useRef(new Set());
    const restoringFocusRef = useRef(false);

    const recordOnce = (event, details = {}) => {
        if (recordedEventsRef.current.has(event)) return;
        recordedEventsRef.current.add(event);
        window.dispatchEvent(new CustomEvent('osoo:login-ui-diagnostic', {
            detail: {
                event,
                details: {
                    elapsedMs: mountedAtRef.current ? Date.now() - mountedAtRef.current : 0,
                    ...details,
                },
            },
        }));
    };

    useEffect(() => {
        mountedAtRef.current = Date.now();
        const hasPrefilledName = Boolean(nameRef.current?.value);
        recordOnce('login-view-mounted', { hasPrefilledName });
        window.focus();
        const timer = window.setTimeout(() => {
            (hasPrefilledName ? passRef.current : nameRef.current)?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        const restoreInputFocus = (info = {}) => {
            if (restoringFocusRef.current) return;
            restoringFocusRef.current = true;
            window.focus();
            window.requestAnimationFrame(() => {
                const active = document.activeElement;
                const activeIsLoginInput = active === nameRef.current || active === passRef.current;
                const target = activeIsLoginInput
                    ? active
                    : (nameRef.current?.value ? passRef.current : nameRef.current);
                target?.focus({ preventScroll: true });
                recordOnce('login-focus-restored', { reason: info.reason || 'window-focus' });
                restoringFocusRef.current = false;
            });
        };

        const unsubscribe = window.electronAPI?.onWindowRestored?.(restoreInputFocus);
        const handleWindowFocus = () => restoreInputFocus({ reason: 'window-focus' });
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
                recordOnce('login-hint-skipped-after-edit');
                return;
            }
            setName(nextName);
            recordOnce('login-hint-applied');
            setPass('');
            setError('');
            passRef.current?.focus();
        }, 0);
        return () => clearTimeout(timer);
    }, [loginHintName]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        recordOnce('login-submit', { hasName: Boolean(name), hasPassword: Boolean(pass) });
        const result = await onLogin(name, pass);
        recordOnce(result.success ? 'login-result-success' : 'login-result-failed');
        if (result.success) {
            localStorage.setItem('lastLoginName', name);
        } else {
            setError(result.message);
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
                            onFocus={() => recordOnce('login-name-focused')}
                            onChange={(e) => {
                                hasEditedNameRef.current = true;
                                recordOnce('login-name-first-input');
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
                            type="text"
                            autoComplete="off"
                            className="form-input-new"
                            placeholder="비밀번호"
                            style={{ WebkitTextSecurity: 'disc' }}
                            value={pass}
                            ref={passRef}
                            onPointerDown={() => window.focus()}
                            onFocus={() => recordOnce('login-password-focused')}
                            onChange={(e) => {
                                recordOnce('login-password-first-input');
                                setPass(e.target.value);
                            }}
                            autoFocus
                            required
                        />
                    </div>

                    <button type="submit" className="btn-login-new">
                        로그인
                    </button>

                    {error && (
                        <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.5rem', textAlign: 'center' }}>
                            {error}
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};

export default LoginView;
