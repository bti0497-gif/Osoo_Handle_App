import { useState } from 'react';
import { MemberModel } from './MemberModel';
import { AuthModel } from '../auth/AuthModel';

export const useMembersViewModel = (currentUser, { showAlert } = {}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 실시간 비밀번호 검증
  const isLengthValid = newPassword.length >= 4;
  const isSameAsCurrent = newPassword === currentPassword && currentPassword !== '';
  const isMatching = newPassword === confirmPassword && confirmPassword !== '';
  const isFormValid = isLengthValid && !isSameAsCurrent && isMatching && currentPassword !== '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMsg('');

    // 1. 현재 비밀번호 일치 확인
    if (currentPassword !== currentUser?.password) {
      setErrorMsg('현재 비밀번호가 정확하지 않습니다.');
      return;
    }

    // 2. 신규 비밀번호 길이 유효성 검사
    if (!isLengthValid) {
      setErrorMsg('새 비밀번호는 최소 4자 이상이어야 합니다.');
      return;
    }

    // 3. 현재 비밀번호와 동일한지 확인
    if (newPassword === currentPassword) {
      setErrorMsg('새 비밀번호는 현재 비밀번호와 다르게 설정해야 합니다.');
      return;
    }

    // 4. 비밀번호 확인 일치 검사
    if (newPassword !== confirmPassword) {
      setErrorMsg('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedUser = {
        ...currentUser,
        password: newPassword
      };

      // 서버 및 구글 시트에 업데이트 반영
      await MemberModel.saveMember(updatedUser);

      // 로컬 세션 캐시 업데이트 (자동 로그아웃 방지 및 세션 유지용)
      AuthModel.saveSession(updatedUser);

      setIsSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('비밀번호 업데이트 실패:', err);
      setErrorMsg(err.message || '비밀번호 변경 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setIsSuccess(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMsg('');
  };

  return {
    // State
    currentPassword,
    newPassword,
    confirmPassword,
    isSubmitting,
    isSuccess,
    errorMsg,

    // Validation
    isLengthValid,
    isSameAsCurrent,
    isMatching,
    isFormValid,

    // Handlers
    setCurrentPassword,
    setNewPassword,
    setConfirmPassword,
    handleSubmit,
    handleReset,
  };
};
