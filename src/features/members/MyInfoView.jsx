import React from 'react';
import { useDialog } from '../../components/common/DialogContext';
import { useMembersViewModel } from './useMembersViewModel';

export function MyInfoView({ currentUser }) {
    const { showAlert } = useDialog();
    const vm = useMembersViewModel(currentUser, { showAlert });
    const {
        currentPassword, setCurrentPassword,
        newPassword, setNewPassword,
        confirmPassword, setConfirmPassword,
        isSubmitting, isSuccess, errorMsg,
        isLengthValid, isSameAsCurrent, isMatching, isFormValid,
        handleSubmit, handleReset,
    } = vm;

    if (isSuccess) {
        return (
            <div style={styles.container}>
                <div style={styles.glassCard}>
                    <div style={styles.successWrapper}>
                        <div style={styles.successIconOuter}>
                            <div style={styles.successIcon}>
                                <span className="material-icons" style={styles.checkIcon}>check</span>
                            </div>
                        </div>
                        <h2 style={styles.successTitle}>비밀번호 변경 완료!</h2>
                        <p style={styles.successSubtitle}>
                            회원님의 비밀번호가 성공적으로 변경되었습니다.<br />
                            다음 로그인 시 변경된 비밀번호를 사용해 주세요.
                        </p>
                        <button 
                            onClick={handleReset}
                            style={styles.actionBtn}
                        >
                            확인
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.glassCard}>
                <div style={styles.header}>
                    <div style={styles.iconContainer}>
                        <span className="material-icons" style={styles.headerIcon}>lock_person</span>
                    </div>
                    <h2 style={styles.title}>비밀번호 변경</h2>
                    <p style={styles.subtitle}>
                        소중한 개인정보 보호를 위해 비밀번호를 안전하게 관리하세요.
                    </p>
                </div>

                <form onSubmit={handleSubmit} style={styles.form}>
                    {/* 현재 사용자명 안내 */}
                    <div style={styles.formGroup}>
                        <label style={styles.label}>사용자 이름</label>
                        <input 
                            type="text" 
                            value={currentUser?.name || ''} 
                            disabled 
                            style={styles.inputDisabled}
                        />
                    </div>

                    {/* 현재 비밀번호 입력 */}
                    <div style={styles.formGroup}>
                        <label style={styles.label}>현재 비밀번호</label>
                        <div style={styles.inputWrapper}>
                            <span className="material-icons" style={styles.inputIcon}>lock_open</span>
                            <input 
                                type="password" 
                                placeholder="현재 사용 중인 비밀번호 입력"
                                value={currentPassword}
                                onChange={(e) => {
                                    setCurrentPassword(e.target.value);
                                    setErrorMsg('');
                                }}
                                style={styles.input}
                                required
                            />
                        </div>
                    </div>

                    {/* 새 비밀번호 입력 */}
                    <div style={styles.formGroup}>
                        <label style={styles.label}>새 비밀번호</label>
                        <div style={styles.inputWrapper}>
                            <span className="material-icons" style={styles.inputIcon}>lock</span>
                            <input 
                                type="password" 
                                placeholder="새로 설정할 비밀번호 입력 (4자 이상)"
                                value={newPassword}
                                onChange={(e) => {
                                    setNewPassword(e.target.value);
                                    setErrorMsg('');
                                }}
                                style={styles.input}
                                required
                            />
                        </div>
                    </div>

                    {/* 새 비밀번호 확인 */}
                    <div style={styles.formGroup}>
                        <label style={styles.label}>새 비밀번호 확인</label>
                        <div style={styles.inputWrapper}>
                            <span className="material-icons" style={styles.inputIcon}>gpp_good</span>
                            <input 
                                type="password" 
                                placeholder="새 비밀번호 다시 한 번 입력"
                                value={confirmPassword}
                                onChange={(e) => {
                                    setConfirmPassword(e.target.value);
                                    setErrorMsg('');
                                }}
                                style={styles.input}
                                required
                            />
                        </div>
                    </div>

                    {/* 실시간 힌트 가이드 */}
                    <div style={styles.guideContainer}>
                        <div style={styles.guideItem}>
                            <span className="material-icons" style={{
                                ...styles.guideIcon,
                                color: isLengthValid ? '#059669' : '#94a3b8'
                            }}>
                                {isLengthValid ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            <span style={{
                                ...styles.guideText,
                                color: isLengthValid ? '#059669' : '#64748b'
                            }}>최소 4자 이상</span>
                        </div>

                        <div style={styles.guideItem}>
                            <span className="material-icons" style={{
                                ...styles.guideIcon,
                                color: currentPassword && newPassword && !isSameAsCurrent ? '#059669' : '#94a3b8'
                            }}>
                                {currentPassword && newPassword && !isSameAsCurrent ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            <span style={{
                                ...styles.guideText,
                                color: currentPassword && newPassword && !isSameAsCurrent ? '#059669' : '#64748b'
                            }}>현재 비밀번호와 다르게 설정</span>
                        </div>

                        <div style={styles.guideItem}>
                            <span className="material-icons" style={{
                                ...styles.guideIcon,
                                color: isMatching ? '#059669' : '#94a3b8'
                            }}>
                                {isMatching ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            <span style={{
                                ...styles.guideText,
                                color: isMatching ? '#059669' : '#64748b'
                            }}>새 비밀번호 일치 확인</span>
                        </div>
                    </div>

                    {/* 에러 메시지 */}
                    {errorMsg && (
                        <div style={styles.errorAlert}>
                            <span className="material-icons" style={styles.errorIcon}>error_outline</span>
                            <span style={styles.errorText}>{errorMsg}</span>
                        </div>
                    )}

                    {/* 제출 버튼 */}
                    <button 
                        type="submit" 
                        disabled={!isFormValid || isSubmitting}
                        style={{
                            ...styles.submitBtn,
                            ...(isFormValid && !isSubmitting ? styles.submitBtnEnabled : styles.submitBtnDisabled)
                        }}
                    >
                        {isSubmitting ? (
                            <div style={styles.loaderContainer}>
                                <div style={styles.spinner} />
                                <span>비밀번호 업데이트 중...</span>
                            </div>
                        ) : (
                            '비밀번호 저장하기'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}

const styles = {
    container: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        minHeight: 'calc(100vh - 120px)',
        background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
        padding: '2rem',
    },
    glassCard: {
        width: '100%',
        maxWidth: '480px',
        background: 'rgba(255, 255, 255, 0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.6)',
        borderRadius: '24px',
        padding: '2.5rem',
        boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.02)',
        animation: 'fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
    },
    header: {
        textAlign: 'center',
        marginBottom: '2rem',
    },
    iconContainer: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '64px',
        height: '64px',
        borderRadius: '20px',
        background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
        boxShadow: '0 8px 16px -4px rgba(79, 70, 229, 0.3)',
        marginBottom: '1rem',
    },
    headerIcon: {
        color: '#ffffff',
        fontSize: '32px',
    },
    title: {
        fontSize: '1.5rem',
        fontWeight: '800',
        color: '#0f172a',
        letterSpacing: '-0.025em',
        margin: '0 0 0.5rem 0',
    },
    subtitle: {
        fontSize: '0.875rem',
        color: '#64748b',
        lineHeight: '1.5',
        margin: 0,
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
    },
    formGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
    },
    label: {
        fontSize: '0.8125rem',
        fontWeight: '700',
        color: '#334155',
        textIndent: '4px',
    },
    inputDisabled: {
        height: '48px',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        background: '#f8fafc',
        color: '#94a3b8',
        fontSize: '0.9375rem',
        fontWeight: '600',
        padding: '0 1rem',
        outline: 'none',
        cursor: 'not-allowed',
    },
    inputWrapper: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
    },
    inputIcon: {
        position: 'absolute',
        left: '14px',
        color: '#94a3b8',
        fontSize: '20px',
        pointerEvents: 'none',
    },
    input: {
        width: '100%',
        height: '48px',
        borderRadius: '12px',
        border: '1px solid #cbd5e1',
        background: '#ffffff',
        color: '#0f172a',
        fontSize: '0.9375rem',
        padding: '0 1rem 0 2.75rem',
        outline: 'none',
        transition: 'all 0.2s ease',
    },
    guideContainer: {
        background: '#f8fafc',
        borderRadius: '12px',
        padding: '0.875rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        border: '1px solid #f1f5f9',
    },
    guideItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    guideIcon: {
        fontSize: '16px',
        transition: 'color 0.2s ease',
    },
    guideText: {
        fontSize: '0.75rem',
        fontWeight: '600',
        transition: 'color 0.2s ease',
    },
    errorAlert: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0.875rem 1rem',
        background: '#fff1f2',
        border: '1px solid #ffe4e6',
        borderRadius: '12px',
        color: '#be123c',
    },
    errorIcon: {
        fontSize: '20px',
        flexShrink: 0,
    },
    errorText: {
        fontSize: '0.8125rem',
        fontWeight: '600',
    },
    submitBtn: {
        height: '52px',
        borderRadius: '14px',
        border: 'none',
        fontSize: '1rem',
        fontWeight: '800',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
        marginTop: '0.5rem',
    },
    submitBtnEnabled: {
        background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
        color: '#ffffff',
        boxShadow: '0 10px 20px -6px rgba(79, 70, 229, 0.3)',
    },
    submitBtnDisabled: {
        background: '#e2e8f0',
        color: '#94a3b8',
        cursor: 'not-allowed',
    },
    loaderContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    spinner: {
        width: '18px',
        height: '18px',
        border: '2px solid rgba(255,255,255,0.3)',
        borderTopColor: '#ffffff',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
    },
    // 성공 시 뷰 스타일
    successWrapper: {
        textAlign: 'center',
        padding: '1rem 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
    },
    successIconOuter: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '80px',
        height: '80px',
        borderRadius: '50%',
        background: '#ecfdf5',
        marginBottom: '1.5rem',
    },
    successIcon: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '56px',
        height: '56px',
        borderRadius: '50%',
        background: '#10b981',
        boxShadow: '0 6px 16px -4px rgba(16, 185, 129, 0.4)',
    },
    checkIcon: {
        color: '#ffffff',
        fontSize: '32px',
        fontWeight: 'bold',
    },
    successTitle: {
        fontSize: '1.5rem',
        fontWeight: '800',
        color: '#065f46',
        margin: '0 0 0.75rem 0',
        letterSpacing: '-0.025em',
    },
    successSubtitle: {
        fontSize: '0.9375rem',
        color: '#047857',
        lineHeight: '1.6',
        margin: '0 0 2rem 0',
        fontWeight: '500',
    },
    actionBtn: {
        width: '100%',
        height: '50px',
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        color: '#ffffff',
        border: 'none',
        borderRadius: '14px',
        fontSize: '1rem',
        fontWeight: '800',
        cursor: 'pointer',
        boxShadow: '0 10px 20px -6px rgba(16, 185, 129, 0.3)',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    }
};

export default MyInfoView;
