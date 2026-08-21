import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';

const diagnosticRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: diagnosticRoot,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
});
