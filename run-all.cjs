const { spawn } = require('child_process');
const path = require('path');

console.log('Starting both Frontend (Vite) and Backend (Node) servers...');

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
