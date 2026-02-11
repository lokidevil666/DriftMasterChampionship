import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/static/',
  build: {
    outDir: '../app/static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
      '/classifications': { target: 'http://localhost:8000', changeOrigin: true },
      '/competitions': { target: 'http://localhost:8000', changeOrigin: true },
      '/drivers': { target: 'http://localhost:8000', changeOrigin: true },
      '/judges': { target: 'http://localhost:8000', changeOrigin: true },
      '/battles': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true, changeOrigin: true },
    },
  },
})
