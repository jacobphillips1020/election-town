/** "Pat Rivera" -> "Pat R."; "Sam K" -> "Sam K."; "Lee" -> "Lee". */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return parts[0] || 'Someone'
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}
