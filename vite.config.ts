import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

// https://vite.dev/config/
export default defineConfig({
  // Use relative asset paths so production renderer works with Electron file:// URLs.
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
})
