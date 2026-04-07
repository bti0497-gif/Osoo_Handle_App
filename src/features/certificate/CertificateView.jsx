import React from 'react';

const CertificateView = ({ currentUser }) => {
    return (
        <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#ffffff',
            padding: '1.25rem',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
        }}>
            <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#cbd5e1',
            }}>
                <div style={{ textAlign: 'center' }}>
                    <span className="material-icons" style={{ fontSize: '48px', display: 'block', marginBottom: '1rem' }}>
                        description
                    </span>
                    <p style={{ fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                        성적서 기능이 준비 중입니다.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CertificateView;
