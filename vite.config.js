import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8900,         // Unique port for Wastewater Treatment Plant app
    strictPort: false,  // Automatically try next port if 8900 is in use
  }
})
