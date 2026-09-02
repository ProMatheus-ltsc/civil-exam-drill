import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared/core': path.resolve(directory, '../shared-core/src') },
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', 'react-hook-form'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4174',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173 },
})
