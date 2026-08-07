import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// getUserMedia sólo está disponible en contextos seguros. En localhost alcanza con http,
// pero para probar desde un teléfono en la red local hace falta HTTPS:
// VITE_USE_HTTPS=true npm run dev
const useHttps = process.env.VITE_USE_HTTPS === 'true'

const httpsConfig = useHttps
  ? {
      key: fs.readFileSync(path.resolve(rootDir, 'ssl/key.pem')),
      cert: fs.readFileSync(path.resolve(rootDir, 'ssl/cert.pem')),
    }
  : undefined

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: httpsConfig,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
