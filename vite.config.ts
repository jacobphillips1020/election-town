/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A production deploy must never fall back to demo mode silently: fail the build instead.
if (process.env.VERCEL_ENV === 'production' && !(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY)) {
  throw new Error('Production build is missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (check Vercel environment variables).')
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000 },
})
