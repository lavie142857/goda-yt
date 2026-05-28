import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Use relative asset paths so production renderer works with Electron file:// URLs.
  base: './',
  plugins: [react()],
})
