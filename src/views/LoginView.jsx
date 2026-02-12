import React, { useState, useEffect, useRef } from 'react';

const LoginView = ({ onLogin }) => {
    const [name, setName] = useState('');
    const [pass, setPass] = useState('');
    const [error, setError] = useState('');

    const passRef = useRef(null);

    useEffect(() => {
        const savedName = localStorage.getItem('lastLoginName');
        if (savedName) {
            setName(savedName);
            if (passRef.current) {
                passRef.current.focus();
            }
        }
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        const result = onLogin(name, pass);
        if (result.success) {
            localStorage.setItem('lastLoginName', name);
        } else {
            setError(result.message);
        }
    };

    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-header">
                    <p className="login-subtitle">통합관리시스템 로그인</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="login-form-layout">
                        <div className="login-inputs">
                            <div className="compact-row">
                                <label className="compact-label">이 &nbsp; &nbsp; &nbsp; 름</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="compact-row">
                                <label className="compact-label">비밀번호</label>
                                <input
                                    type="password"
                                    className="form-input"
                                    value={pass}
                                    onChange={(e) => setPass(e.target.value)}
                                    ref={passRef}
                                    required
                                />
                            </div>
                        </div>

                        <button type="submit" className="btn-login-compact">
                            로그인
                        </button>
                    </div>

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
