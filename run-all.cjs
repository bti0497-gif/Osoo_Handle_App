const { spawn } = require('child_process');
const path = require('path');

console.log('Starting both Frontend (Vite) and Backend (Node) servers...');

function cleanupExistingBackendProcesses() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            resolve();
            return;
        }

        const scriptRoot = __dirname.replace(/'/g, "''");
        const cleanupScript = [
            `$root = '${scriptRoot}'`,
            "$processes = Get-CimInstance Win32_Process",
            "$processes | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match [regex]::Escape($root) -and ($_.CommandLine -match 'server\\.cjs' -or $_.CommandLine -match 'start\\.cjs' -or $_.CommandLine -match 'vite') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
        ].join('; ');

        const killer = spawn('powershell.exe', ['-NoProfile', '-Command', cleanupScript], {
            stdio: 'inherit',
            cwd: __dirname
        });

        killer.on('exit', () => resolve());
        killer.on('error', () => resolve());
    });
}

async function startAll() {
    await cleanupExistingBackendProcesses();

    // 1. Start the Node.js backend (using the watchdog script)
    const backend = spawn('node', ['start.cjs'], {
        stdio: 'inherit',
        shell: true,
        cwd: __dirname
    });

    // 2. Start the Vite development server
    const frontend = spawn('npx', ['vite'], {
        stdio: 'inherit',
        shell: true,
        cwd: __dirname
    });

    // Handle termination gracefully
    function shutdown() {
        console.log('\nShutting down both servers...');
        backend.kill('SIGTERM');
        frontend.kill('SIGTERM');
        process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

startAll();
