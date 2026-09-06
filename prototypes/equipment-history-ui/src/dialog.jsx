// 본앱의 DialogContext(useDialog)를 대신하는 프로토타입용 다이얼로그.
// 본앱의 스타일 다이얼로그와 비슷한 모습으로 동작하고 await으로 결과를 받는다.
// 본앱 이식 시 이 파일만 제거하고 뷰의 import를
// '../../components/common/DialogContext'로 되돌린다. 그 외 코드는 불변.
import React, { useCallback, useEffect, useState } from 'react';

let pendingDialog = null;
const listeners = new Set();

function openDialog(dialog) {
  return new Promise((resolve) => {
    pendingDialog = { ...dialog, resolve };
    listeners.forEach((listener) => listener(pendingDialog));
  });
}

function closeDialog(result) {
  const current = pendingDialog;
  pendingDialog = null;
  listeners.forEach((listener) => listener(null));
  if (current) current.resolve(result);
}

export function useDialog() {
  const showAlert = useCallback((message, title) => openDialog({ type: 'alert', message, title }), []);
  const showConfirm = useCallback((message, title) => openDialog({ type: 'confirm', message, title }), []);
  return { showAlert, showConfirm };
}

export function PrototypeDialogHost() {
  const [dialog, setDialog] = useState(pendingDialog);

  useEffect(() => {
    listeners.add(setDialog);
    return () => listeners.delete(setDialog);
  }, []);

  if (!dialog) return null;
  return (
    <div className="prototype-dialog-backdrop" role="presentation">
      <div className="prototype-dialog" role="alertdialog" aria-modal="true" aria-label={dialog.title || '알림'}>
        {dialog.title ? <h3>{dialog.title}</h3> : null}
        <p>{dialog.message}</p>
        <div className="prototype-dialog-actions">
          {dialog.type === 'confirm' ? (
            <button type="button" onClick={() => closeDialog(false)}>취소</button>
          ) : null}
          <button type="button" className="primary" autoFocus onClick={() => closeDialog(true)}>확인</button>
        </div>
      </div>
    </div>
  );
}
