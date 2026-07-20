const { spawn } = require('child_process');
const path = require('path');

const FRONTEND_PORT = 18735;
const BACKEND_PORT_MIN = 18731;
const BACKEND_PORT_MAX = 18734;

let frontend = null;
let electron = null;
let isShuttingDown = false;

console.log('Restarting Frontend and Electron app...');

function buildWindowsCleanupScript() {
    const scriptRoot = __dirname.replace(/'/g, "''");
    const currentPid = process.pid;
    const parentPid = process.ppid || 0;

    return `
$ErrorActionPreference = 'SilentlyContinue'
$rootNormalized = '${scriptRoot}'.Replace('\\', '/').ToLower()
$currentPid = ${currentPid}
$parentPid = ${parentPid}
$excludedIds = @($currentPid, $parentPid, $PID)
$targetPorts = @(${Array.from({ length: FRONTEND_PORT - BACKEND_PORT_MIN + 1 }, (_, index) => BACKEND_PORT_MIN + index).join(', ')})
$candidateIds = New-Object 'System.Collections.Generic.HashSet[int]'

Get-NetTCPConnection -State Listen |
    Where-Object { $targetPorts -contains $_.LocalPort -and $excludedIds -notcontains $_.OwningProcess } |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { [void]$candidateIds.Add([int]$_) }

Get-CimInstance Win32_Process |
    Where-Object {
        $excludedIds -notcontains $_.ProcessId -and
        @('node.exe', 'electron.exe', 'Osoo Handle App.exe') -contains $_.Name -and
        $_.CommandLine -and
        $_.CommandLine.Replace('\\', '/').ToLower().Contains($rootNormalized) -and
        (
            $_.CommandLine -match 'start\\.cjs' -or
            $_.CommandLine -match 'server\\.cjs' -or
            $_.CommandLine -match 'vite(?:\\.js)?' -or
            $_.CommandLine -match 'electron(?:\\.exe)?'
        )
    } |
    ForEach-Object { [void]$candidateIds.Add([int]$_.ProcessId) }

$candidateIds | ForEach-Object {
    Stop-Process -Id $_ -Force
}
Start-Sleep -Milliseconds 1200
`.trim();
}

function cleanupExistingDevProcesses() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            resolve();
            return;
        }

        const killer = spawn('powershell.exe', ['-NoProfile', '-Command', buildWindowsCleanupScript()], {
            stdio: 'inherit',
            cwd: __dirname,
        });

        killer.on('exit', () => resolve());
        killer.on('error', () => resolve());
    });
}

function spawnCommand(command, args, options = {}) {
    return spawn(command, args, {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true,
        ...options,
    });
}

function runCommandAndWait(command, args, label) {
    return new Promise((resolve, reject) => {
        const child = spawnCommand(command, args);
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${label} failed with exit code ${code}`));
        });
    });
}

function buildElectronEnv() {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, label, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const res = await fetch(url, { method: 'GET' });
            if (res.ok) {
                console.log(`[${label}] ready: ${url}`);
                return true;
            }
        } catch (_) {
            // keep waiting
        }
        await wait(500);
    }
    throw new Error(`${label} did not become ready: ${url}`);
}

async function waitForFrontendReady() {
    const urls = [
        `http://localhost:${FRONTEND_PORT}`,
        `http://127.0.0.1:${FRONTEND_PORT}`,
        `http://[::1]:${FRONTEND_PORT}`,
    ];
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
        for (const url of urls) {
            try {
                const res = await fetch(url, { method: 'GET' });
                if (res.ok) {
                    console.log(`[Frontend] ready: ${url}`);
                    return url;
                }
            } catch (_) {
                // try next host
            }
        }
        await wait(500);
    }
    throw new Error(`Frontend did not become ready on port ${FRONTEND_PORT}`);
}

async function waitForBackendReady() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
        for (let port = BACKEND_PORT_MIN; port <= BACKEND_PORT_MAX; port += 1) {
            try {
                // ping의 ready=true는 DB/전체 라우트 초기화 완료 뒤에만 설정된다.
                const url = `http://127.0.0.1:${port}/api/ping`;
                const res = await fetch(url, { method: 'GET' });
                const payload = res.ok ? await res.json() : null;
                if (payload?.app === 'osoo-handle-app' && payload?.ready === true) {
                    console.log(`[Backend] ready: ${url}`);
                    return port;
                }
            } catch (_) {
                // try next port
            }
        }
        await wait(500);
    }
    throw new Error(`Backend did not become ready on ports ${BACKEND_PORT_MIN}-${BACKEND_PORT_MAX}`);
}

function killProcessTree(childProcess) {
    if (!childProcess || childProcess.killed) {
        return;
    }

    if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(childProcess.pid), '/t', '/f'], {
            stdio: 'ignore',
            shell: true,
        });
        killer.on('error', () => {
            try { childProcess.kill('SIGTERM'); } catch (_) {}
        });
        return;
    }

    try {
        childProcess.kill('SIGTERM');
    } catch (_) {}
}

function shutdown(exitCode = 0) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log('\nShutting down dev processes...');
    killProcessTree(frontend);
    killProcessTree(electron);

    setTimeout(() => process.exit(exitCode), 300);
}

function bindChildExit(childProcess, label) {
    childProcess.on('exit', (code, signal) => {
        if (isShuttingDown) {
            return;
        }

        const exitCode = typeof code === 'number' ? code : 0;
        console.log(`[${label}] exited (code=${code}, signal=${signal})`);
        shutdown(exitCode);
    });

    childProcess.on('error', (error) => {
        if (isShuttingDown) {
            return;
        }

        console.error(`[${label}] failed to start: ${error.message}`);
        shutdown(1);
    });
}

async function startAll() {
    await cleanupExistingDevProcesses();
    console.log('[Native] Rebuilding better-sqlite3 for Electron 40.6.0...');
    await runCommandAndWait(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['@electron/rebuild', '--force', '--arch=x64', '--electron-version=40.6.0'],
        'Electron native rebuild'
    );
    // Start the Vite frontend HMR server.
    frontend = spawnCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
        env: { ...process.env },
    });
    bindChildExit(frontend, 'frontend');
    await waitForFrontendReady();
    // Run the local Electron binary directly to avoid npx resolution issues.
    let electronCmd = process.platform === 'win32'
        ? path.join(__dirname, 'node_modules', '.bin', 'electron.cmd')
        : path.join(__dirname, 'node_modules', '.bin', 'electron');
    // Quote the path on Windows when the project path contains spaces.
    if (process.platform === 'win32' && electronCmd.includes(' ')) {
        electronCmd = `"${electronCmd}"`;
    }

    if (!isShuttingDown) {
        console.log('[Electron] Starting app with DevTools...');
        electron = spawnCommand(electronCmd, ['.'], {
            env: buildElectronEnv(),
        });
        bindChildExit(electron, 'electron');
        await waitForBackendReady();
    }

    process.on('SIGINT', () => shutdown(0));
    process.on('SIGTERM', () => shutdown(0));
}

startAll().catch((error) => {
    console.error(`Failed to start dev servers: ${error.message}`);
    shutdown(1);
});

