/**
 * Split `totalCents` into `count` whole-cent parts that always add up to the total.
 * The first `total % count` parts get one extra cent (member join order).
 * Example: split(1000, 3) -> [334, 333, 333]
 */
export function splitCents(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('totalCents must be a positive whole number')
  }
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError('count must be a positive whole number')
  }
  const base = Math.floor(totalCents / count)
  const remainder = totalCents % count
  return Array.from({ length: count }, (_, index) => (index < remainder ? base + 1 : base))
}
