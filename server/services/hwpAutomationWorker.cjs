'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const { ensureHwpSecurityModule } = require('./hwpPdfService.cjs');

const SECURITY_MODULE_NAME = 'OsooHandleFilePathChecker';
const RESPONSE_PREFIX = '__OSOO_HWP_WORKER__';
const READY_TIMEOUT_MS = 45 * 1000;
const WARMUP_TIMEOUT_MS = 60 * 1000;
const BIND_TIMEOUT_MS = 180 * 1000;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const FAILURE_RETRY_DELAY_MS = 60 * 1000;

let workerState = null;
let commandSequence = 0;
let lastStartupFailureAt = 0;

function toPowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function buildEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function buildWorkerScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$prefix = ${toPowerShellLiteral(RESPONSE_PREFIX)}`,
    'function Send-Result([hashtable]$payload) {',
    "  $json = $payload | ConvertTo-Json -Compress -Depth 6",
    '  [Console]::Out.WriteLine($prefix + $json)',
    '  [Console]::Out.Flush()',
    '}',
    '$hwp = $null',
    'try {',
    '  $hwp = New-Object -ComObject HWPFrame.HwpObject',
    `  $securityRegistered = $hwp.RegisterModule('FilePathCheckDLL', '${SECURITY_MODULE_NAME}')`,
    "  if (-not $securityRegistered) { throw '한글 파일 접근 보안 모듈 등록에 실패했습니다.' }",
    '  try { $hwp.SetMessageBoxMode(0x00020000) } catch { }',
    '  try { $hwp.XHwpWindows.Item(0).Visible = $false } catch { }',
    "  Send-Result @{ type = 'ready'; success = $true }",
    '  while (($line = [Console]::In.ReadLine()) -ne $null) {',
    '    if ([string]::IsNullOrWhiteSpace($line)) { continue }',
    '    $command = $null',
    '    $documentOpened = $false',
    '    try {',
    '      $command = $line | ConvertFrom-Json',
    '      $commandId = [string]$command.id',
    "      if ([string]$command.type -eq 'shutdown') {",
    "        Send-Result @{ type = 'response'; id = $commandId; success = $true }",
    '        break',
    '      }',
    '      $templatePath = [string]$command.templatePath',
    "      if (-not (Test-Path -LiteralPath $templatePath)) { throw ('HWP template not found: ' + $templatePath) }",
    "      $opened = $hwp.Open($templatePath, 'HWP', 'forceopen:true')",
    "      if (-not $opened) { throw '한글에서 HWP 기본양식을 열지 못했습니다.' }",
    '      $documentOpened = $true',
    "      if ([string]$command.type -eq 'warmup') {",
    "        [void]$hwp.GetTextFile('HWPML2X', '')",
    "        Send-Result @{ type = 'response'; id = $commandId; success = $true; warmed = $true }",
    '        continue',
    '      }',
    "      if ([string]$command.type -ne 'bind') { throw ('지원하지 않는 HWP 명령입니다: ' + [string]$command.type) }",
    '      $outputPath = [string]$command.outputPath',
    '      $valuesPath = [string]$command.valuesPath',
    "      if (-not (Test-Path -LiteralPath $valuesPath)) { throw ('HWP bookmark values not found: ' + $valuesPath) }",
    '      if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }',
    '      $outputDirectory = Split-Path -Parent $outputPath',
    '      if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }',
    '      $values = Get-Content -LiteralPath $valuesPath -Raw -Encoding UTF8 | ConvertFrom-Json',
    "      $xml = [string]$hwp.GetTextFile('HWPML2X', '')",
    '      $replaced = 0',
    '      foreach ($property in $values.PSObject.Properties) {',
    '        $name = [string]$property.Name',
    "        $value = if ($null -eq $property.Value) { '' } else { [string]$property.Value }",
    '        $escapedName = [System.Security.SecurityElement]::Escape($name)',
    "        $marker = '<BOOKMARK Name=\"' + $escapedName + '\"/>'",
    '        if (-not $xml.Contains($marker)) { continue }',
    '        $escapedValue = [System.Security.SecurityElement]::Escape($value)',
    "        $xml = $xml.Replace($marker, $marker + '<CHAR>' + $escapedValue + '</CHAR>')",
    '        $replaced += 1',
    '      }',
    "      if ($replaced -eq 0) { throw 'HWP 양식에서 바인딩 가능한 책갈피를 찾지 못했습니다.' }",
    "      $loaded = $hwp.SetTextFile($xml, 'HWPML2X', '')",
    "      if ($loaded -ne 1) { throw '바인딩된 HWP 문서를 다시 불러오지 못했습니다.' }",
    "      $saved = $hwp.SaveAs($outputPath, 'HWP', '')",
    "      if (-not $saved) { throw '바인딩된 HWP 문서를 저장하지 못했습니다.' }",
    "      Send-Result @{ type = 'response'; id = $commandId; success = $true; replacedCount = $replaced }",
    '    } catch {',
    "      $failedId = if ($null -ne $command) { [string]$command.id } else { '' }",
    "      Send-Result @{ type = 'response'; id = $failedId; success = $false; error = [string]$_.Exception.Message }",
    '    } finally {',
    '      if ($documentOpened) { try { $hwp.Clear(1) } catch { } }',
    '    }',
    '  }',
    '} catch {',
    "  Send-Result @{ type = 'fatal'; success = $false; error = [string]$_.Exception.Message }",
    '} finally {',
    '  if ($null -ne $hwp) {',
    '    try { $hwp.Clear(1) } catch { }',
    '    try { $hwp.Quit() } catch { }',
    '    try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp) } catch { }',
    '  }',
    '  [GC]::Collect()',
    '  [GC]::WaitForPendingFinalizers()',
    '}',
  ].join('\n');
}

function rejectPending(state, error) {
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  state.pending.clear();
}

function disposeWorker(state, reason = 'disposed') {
  if (!state || state.disposed) return;
  state.disposed = true;
  clearTimeout(state.idleTimer);
  rejectPending(state, new Error(`HWP 작업 프로세스가 종료되었습니다: ${reason}`));
  try {
    state.input.end(`${JSON.stringify({ type: 'shutdown', id: `shutdown-${Date.now()}` })}\n`, 'utf8');
  } catch { }
  if (state.child.exitCode === null) {
    const killTimer = setTimeout(() => {
      try { state.child.kill(); } catch { }
    }, 10 * 1000);
    killTimer.unref?.();
  }
  if (workerState === state) workerState = null;
}

function scheduleIdleShutdown(state) {
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    if (state.pending.size > 0 || state.disposed) return;
    console.log('[HWP Engine] 유휴 시간이 지나 작업 프로세스를 종료합니다.');
    disposeWorker(state, 'idle-timeout');
  }, IDLE_TIMEOUT_MS);
  state.idleTimer.unref?.();
}

function spawnWorker() {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', buildEncodedCommand(buildWorkerScript())],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const state = {
    child,
    input: child.stdin,
    pending: new Map(),
    warmedTemplates: new Set(),
    stderr: '',
    disposed: false,
    idleTimer: null,
    readyPromise,
  };
  const readyTimer = setTimeout(() => {
    const error = new Error('HWP 작업 프로세스가 제한시간 내에 준비되지 않았습니다.');
    rejectReady(error);
    disposeWorker(state, 'ready-timeout');
  }, READY_TIMEOUT_MS);
  readyTimer.unref?.();

  const output = readline.createInterface({ input: child.stdout });
  output.on('line', (line) => {
    const prefixIndex = line.indexOf(RESPONSE_PREFIX);
    if (prefixIndex < 0) return;
    let payload;
    try {
      payload = JSON.parse(line.slice(prefixIndex + RESPONSE_PREFIX.length));
    } catch {
      return;
    }
    if (payload.type === 'ready') {
      clearTimeout(readyTimer);
      resolveReady(state);
      scheduleIdleShutdown(state);
      return;
    }
    if (payload.type === 'fatal') {
      const error = new Error(payload.error || 'HWP 작업 프로세스 초기화 실패');
      clearTimeout(readyTimer);
      rejectReady(error);
      rejectPending(state, error);
      disposeWorker(state, 'fatal');
      return;
    }
    const pending = state.pending.get(String(payload.id || ''));
    if (!pending) return;
    state.pending.delete(String(payload.id));
    clearTimeout(pending.timer);
    scheduleIdleShutdown(state);
    if (payload.success) pending.resolve(payload);
    else pending.reject(new Error(payload.error || 'HWP 작업 명령 실패'));
  });
  child.stderr.on('data', (chunk) => {
    state.stderr = `${state.stderr}${chunk}`.slice(-4000);
  });
  child.once('error', (error) => {
    clearTimeout(readyTimer);
    rejectReady(error);
    rejectPending(state, error);
    disposeWorker(state, 'spawn-error');
  });
  child.once('exit', (code) => {
    clearTimeout(readyTimer);
    const detail = state.stderr.trim();
    const error = new Error(`HWP 작업 프로세스 종료(code=${code})${detail ? `: ${detail}` : ''}`);
    rejectReady(error);
    rejectPending(state, error);
    if (workerState === state) workerState = null;
    state.disposed = true;
    clearTimeout(state.idleTimer);
  });

  return state;
}

async function ensureWorker() {
  if (workerState && !workerState.disposed && workerState.child.exitCode === null) {
    return workerState.readyPromise;
  }
  if (Date.now() - lastStartupFailureAt < FAILURE_RETRY_DELAY_MS) {
    throw new Error('HWP 작업 프로세스 재시도 대기 중입니다.');
  }
  await ensureHwpSecurityModule();
  const state = spawnWorker();
  workerState = state;
  try {
    return await state.readyPromise;
  } catch (error) {
    lastStartupFailureAt = Date.now();
    disposeWorker(state, 'startup-failed');
    throw error;
  }
}

async function sendCommand(command, timeoutMs) {
  const state = await ensureWorker();
  const id = String(++commandSequence);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      const error = new Error(`HWP 작업 명령 시간이 초과되었습니다: ${command.type}`);
      reject(error);
      disposeWorker(state, 'command-timeout');
    }, timeoutMs);
    timer.unref?.();
    state.pending.set(id, { resolve, reject, timer });
    clearTimeout(state.idleTimer);
    state.input.write(`${JSON.stringify({ ...command, id })}\n`, 'utf8', (error) => {
      if (!error) return;
      clearTimeout(timer);
      state.pending.delete(id);
      reject(error);
      disposeWorker(state, 'stdin-error');
    });
  });
}

async function warmUpHwpAutomation({ templatePath }) {
  const absoluteTemplatePath = path.resolve(templatePath);
  const state = await ensureWorker();
  if (state.warmedTemplates.has(absoluteTemplatePath)) {
    scheduleIdleShutdown(state);
    return { warmed: true, cached: true };
  }
  const result = await sendCommand({ type: 'warmup', templatePath: absoluteTemplatePath }, WARMUP_TIMEOUT_MS);
  state.warmedTemplates.add(absoluteTemplatePath);
  console.log(`[HWP Engine] 준비 완료: ${path.basename(absoluteTemplatePath)}`);
  return { warmed: true, cached: false, ...result };
}

async function bindHwpWithPreparedEngine({ templatePath, outputPath, valuesPath }) {
  const result = await sendCommand({
    type: 'bind',
    templatePath: path.resolve(templatePath),
    outputPath: path.resolve(outputPath),
    valuesPath: path.resolve(valuesPath),
  }, BIND_TIMEOUT_MS);
  return Number(result.replacedCount) || 0;
}

function shutdownHwpAutomationWorker() {
  if (!workerState) return;
  disposeWorker(workerState, 'manual-shutdown');
}

module.exports = {
  warmUpHwpAutomation,
  bindHwpWithPreparedEngine,
  shutdownHwpAutomationWorker,
};
