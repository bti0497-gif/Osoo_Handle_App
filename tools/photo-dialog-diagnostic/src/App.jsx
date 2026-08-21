import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const TESTS = [
  { id: 'visible', title: '기본 파일 입력', placement: '브라우저 기본', description: '화면에 보이는 일반 파일 입력입니다.' },
  { id: 'static-hidden', title: '거래명세서형', placement: '행 외부 · 현재 방식', description: '본앱 공통 사진 버튼을 행 밖에 둔 정상 비교군입니다.' },
  { id: 'dynamic-row-current', title: '약품·필증형', placement: '행 내부 · 현재 본앱', description: '숨은 input 클릭이 부모 행까지 전달되는 현재 본앱 구조입니다.' },
  { id: 'dynamic-row-fixed', title: '약품·필증 비교형', placement: '행 내부 · 전파 차단', stopInputPropagation: true, description: '숨은 input 클릭만 부모 행으로 전달되지 않도록 한 비교군입니다.' },
  { id: 'dynamic-row-multiple', title: '슬러지 반출사진형', placement: '행 내부 · 여러 장', multiple: true, description: '현재 본앱 구조에서 multiple 조건을 함께 재현합니다.' },
  { id: 'rerender-row', title: '입력 교체 비교형', placement: '행 내부 · input 교체', replaceInputOnRowClick: true, description: '부모 행 클릭 때 숨은 input 자체가 교체되는 최악 조건을 비교합니다.' },
];

const now = () => new Date().toISOString();

function fileSummary(file) {
  if (!file) return null;
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  };
}

async function sha256(file) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function TestCard({ test, onSelect, onResult, log }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('대기');
  const [rowSelected, setRowSelected] = useState(false);
  const [rowRevision, setRowRevision] = useState(0);

  const handleFile = useCallback(async (event, source = 'manual') => {
    const files = Array.from(event.target.files || []);
    const file = files[0] || null;
    const resolvedSource = event.currentTarget.dataset.diagnosticSource || source;
    delete event.currentTarget.dataset.diagnosticSource;
    log('renderer-file-change', { testId: test.id, source: resolvedSource, fileCount: files.length, files: files.map(fileSummary), rowSelected, rowRevision });
    if (!file) {
      setStatus('선택 결과 없음');
      onResult(test.id, { status: 'empty', at: now() });
      return;
    }
    try {
      const hash = await sha256(file);
      const result = { status: 'pass', at: now(), file: fileSummary(file), sha256: hash, source: resolvedSource };
      setStatus(`성공 · ${Math.round(file.size / 1024)} KB`);
      onResult(test.id, result);
      log('renderer-file-read-success', { testId: test.id, ...result });
    } catch (error) {
      const result = { status: 'failed', at: now(), message: error?.message || String(error), source: resolvedSource };
      setStatus('파일 읽기 실패');
      onResult(test.id, result);
      log('renderer-file-read-failed', { testId: test.id, ...result });
    } finally {
      event.target.value = '';
    }
  }, [log, onResult, rowRevision, rowSelected, test.id]);

  const openDialog = (event) => {
    event?.stopPropagation();
    log('renderer-file-dialog-requested', { testId: test.id, rowSelected, rowRevision });
    if (inputRef.current) inputRef.current.dataset.diagnosticSource = 'manual';
    inputRef.current?.click();
  };

  const inject = useCallback(async (file) => {
    if (!file || !inputRef.current) throw new Error('자동 시험용 파일 또는 입력 요소가 없습니다.');
    if (test.id !== 'visible' && test.id !== 'static-hidden') {
      setRowSelected(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.dataset.diagnosticSource = 'automatic';
    inputRef.current.files = transfer.files;
    inputRef.current.dispatchEvent(new Event('input', { bubbles: true }));
    inputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
  }, [test.id]);

  useEffect(() => {
    onSelect(test.id, { inject });
    return () => onSelect(test.id, null);
  }, [inject, onSelect, test.id]);

  const content = (
    <>
      <div className="test-copy">
        <div><strong>{test.title}</strong><em>{test.placement}</em></div>
        <span>{test.description}</span>
      </div>
      {test.id === 'visible' ? (
        <input
          ref={inputRef}
          className="visible-input"
          type="file"
          accept="image/*"
          onClick={(event) => {
            event.currentTarget.dataset.diagnosticSource = 'manual';
            log('renderer-visible-input-clicked', { testId: test.id });
          }}
          onChange={(event) => handleFile(event)}
        />
      ) : (
        <>
          <button type="button" className="secondary" onClick={openDialog}>같은 사진 선택</button>
          <input
            key={test.id === 'rerender-row' ? rowRevision : test.id}
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple={Boolean(test.multiple)}
            hidden
            onClick={(event) => {
              if (test.stopInputPropagation) event.stopPropagation();
              log('renderer-hidden-input-clicked', {
                testId: test.id,
                rowSelected,
                rowRevision,
                propagationStopped: Boolean(test.stopInputPropagation),
              });
            }}
            onChange={(event) => handleFile(event)}
          />
        </>
      )}
      <span className={`status ${status.startsWith('성공') ? 'pass' : ''}`}>{status}</span>
    </>
  );

  if (test.id !== 'visible' && test.id !== 'static-hidden') {
    return (
      <div
        className={`test-card row-card ${rowSelected ? 'selected' : ''}`}
        onClick={() => {
          setRowSelected(true);
          if (test.replaceInputOnRowClick) setRowRevision((value) => value + 1);
          log('renderer-parent-row-clicked', { testId: test.id, rowSelected, rowRevision });
        }}
      >
        {content}
      </div>
    );
  }
  return <div className="test-card">{content}</div>;
}

export default function App() {
  const [reference, setReference] = useState(null);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [server, setServer] = useState({ status: '확인 중' });
  const injectorsRef = useRef({});

  const log = useCallback((event, details = {}) => {
    window.photoDiagnostic?.log(event, details);
  }, []);

  const registerInjector = useCallback((id, value) => {
    if (value) injectorsRef.current[id] = value;
    else delete injectorsRef.current[id];
  }, []);

  const updateResult = useCallback((id, value) => {
    setResults((current) => ({ ...current, [id]: value }));
  }, []);

  useEffect(() => {
    log('renderer-mounted', { userAgent: navigator.userAgent, language: navigator.language });
    const eventNames = ['focus', 'blur', 'online', 'offline'];
    const handlers = eventNames.map((name) => {
      const handler = () => log(`window-${name}`, { visibilityState: document.visibilityState });
      window.addEventListener(name, handler);
      return [name, handler];
    });
    const visibilityHandler = () => log('document-visibility-change', { visibilityState: document.visibilityState });
    document.addEventListener('visibilitychange', visibilityHandler);
    window.photoDiagnostic?.probeServer().then(setServer).catch((error) => setServer({ status: '확인 실패', message: error.message }));
    return () => {
      handlers.forEach(([name, handler]) => window.removeEventListener(name, handler));
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [log]);

  const chooseReference = async () => {
    const chosen = await window.photoDiagnostic.chooseReference();
    if (!chosen?.ok) {
      if (!chosen?.canceled) log('reference-file-selection-failed', chosen || {});
      return;
    }
    setReference(chosen);
    setResults({ native: { status: 'pass', at: now(), sha256: chosen.sha256, file: chosen.file } });
    log('reference-file-selection-success', { file: chosen.file, sha256: chosen.sha256 });
  };

  const automaticFile = useMemo(() => {
    if (!reference?.base64) return null;
    const binary = atob(reference.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], reference.file.name, {
      type: reference.file.type || 'application/octet-stream',
      lastModified: reference.file.lastModified,
    });
  }, [reference]);

  const runAutomatic = async () => {
    if (!automaticFile || running) return;
    setRunning(true);
    log('automatic-matrix-started', { file: fileSummary(automaticFile), sha256: reference.sha256 });
    for (const test of TESTS) {
      try {
        await injectorsRef.current[test.id]?.inject(automaticFile);
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error) {
        updateResult(test.id, { status: 'failed', at: now(), message: error?.message || String(error), source: 'automatic' });
        log('automatic-test-failed', { testId: test.id, message: error?.message || String(error) });
      }
    }
    log('automatic-matrix-completed');
    setRunning(false);
  };

  const saveReport = async () => {
    const response = await window.photoDiagnostic.finish({ reference: reference ? { file: reference.file, sha256: reference.sha256 } : null, results });
    if (response?.ok) alert(`진단 결과를 저장했습니다.\n${response.folder}`);
  };

  const passed = Object.values(results).filter((item) => item?.status === 'pass').length;

  return (
    <main className="app-root">
      <header>
        <div>
          <p className="eyebrow">죽암휴게소 사진 선택 원인 분리</p>
          <h1>Osoo 사진 선택 진단</h1>
          <p>본앱, 로컬 DB, 사진 서버에는 아무 데이터도 저장하지 않습니다.</p>
        </div>
        <div className="server-state">
          <span>기존 서버</span>
          <strong>{server.status}{server.port ? ` · ${server.port}` : ''}</strong>
        </div>
      </header>

      <section className="guide">
        <strong>1. 기준 사진을 한 번 선택합니다.</strong>
        <span>자동 검사가 동일한 파일을 네 가지 입력 구조에 넣고 파일 크기와 SHA-256 해시를 비교합니다.</span>
        <button type="button" className="primary" onClick={chooseReference}>기준 사진 선택</button>
        <div className="reference">
          {reference ? <><strong>{reference.file.name}</strong><span>{Math.round(reference.file.size / 1024)} KB · {reference.sha256.slice(0, 16)}…</span></> : <span>선택된 사진 없음</span>}
        </div>
        <button type="button" className="primary" disabled={!reference || running} onClick={runAutomatic}>
          {running ? '자동 진단 중…' : '같은 사진으로 자동 진단'}
        </button>
      </section>

      <section className="test-section">
        <div className="section-heading">
          <div>
            <h2>자동 및 실제 대화상자 비교</h2>
            <p>자동 진단 후 죽암에서 각 ‘사진 선택’ 버튼도 눌러 같은 파일을 선택하면 실제 대화상자 복귀 여부까지 기록됩니다.</p>
          </div>
          <strong>{passed}개 성공</strong>
        </div>
        <div className="test-list">
          {TESTS.map((test) => (
            <TestCard key={test.id} test={test} onSelect={registerInjector} onResult={updateResult} log={log} />
          ))}
        </div>
      </section>

      <footer>
        <div>
          <strong>진단이 끝나면 결과 저장을 누르세요.</strong>
          <span>바탕 화면의 ‘더죤환경’ 폴더에 JSON과 JSONL이 생성됩니다.</span>
        </div>
        <button type="button" className="finish" onClick={saveReport}>진단 결과 저장 및 폴더 열기</button>
      </footer>
    </main>
  );
}
