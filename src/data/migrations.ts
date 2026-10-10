// Loads the real SQL migrations (and the auth stub) as raw text. Shared by tests and demo mode.
const files = import.meta.glob('../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

import authStub from '../../supabase/test_support/auth_stub.sql?raw'

export const AUTH_STUB: string = authStub
export const MIGRATIONS: string[] = Object.keys(files)
  .sort()
  .map((k) => files[k])
