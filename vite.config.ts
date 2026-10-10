/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000 },
})
