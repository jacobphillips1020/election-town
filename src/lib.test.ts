import { expect, test } from 'vitest'
import { loginIdFor, normalizePhone, safeNext } from './lib'

test('phone numbers normalize to one login, however they are typed', () => {
  expect(normalizePhone('(312) 555-0123')).toBe('+13125550123')
  expect(normalizePhone('+1 312 555 0123')).toBe('+13125550123')
  expect(normalizePhone('555-0123')).toBeNull()
  expect(loginIdFor('312.555.0123')).toBe(loginIdFor('+1 (312) 555-0123'))
  expect(loginIdFor('312.555.0123')).toBe('p13125550123@election-town.vercel.app')
  expect(loginIdFor('jake@example.com')).toBe('jake@example.com') // older email accounts still work
  expect(loginIdFor('12')).toBeNull()
})

test('post-login destinations stay inside the app', () => {
  expect(safeNext('/m/abc')).toBe('/m/abc')
  expect(safeNext('//evil.example')).toBe('/')
  expect(safeNext('https://evil.example')).toBe('/')
})
