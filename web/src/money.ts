/** Format whole cents for display. The number is only divided for showing, never stored. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

/** Parse "12", "12.5" or "12.50" into whole cents using string maths (no float rounding). */
export function dollarsToCents(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const [, whole, fraction = ''] = match
  if (whole === undefined) return null
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return cents > 0 ? cents : null
}
