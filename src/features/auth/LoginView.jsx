import React, { useState, useRef } from 'react';
import { useEffect } from 'react';

const LoginView = ({ onLogin, loginHintName = '' }) => {
    const [name, setName] = useState(() => String(loginHintName || localStorage.getItem('lastLoginName') || '').trim());
    const [pass, setPass] = useState('');
    const [error, setError] = useState('');

    const passRef = useRef(null);

    useEffect(() => {
        const nextName = String(loginHintName || '').trim();
        if (!nextName) return;
        setName(nextName);
        setPass('');
        setError('');
        const timer = setTimeout(() => {
            passRef.current?.focus();
        }, 0);
        return () => clearTimeout(timer);
    }, [loginHintName]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const result = await onLogin(name, pass);
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
                    <img src="/logo.png" alt="Logo" style={{ width: '50px', height: 'auto' }} />
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
                            onChange={(e) => setName(e.target.value)}
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
                            onChange={(e) => setPass(e.target.value)}
                            ref={passRef}
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
