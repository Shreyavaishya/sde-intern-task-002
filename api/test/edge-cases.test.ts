import { describe, expect, it } from 'vitest'
import { splitCents } from '../src/split'
import { call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

describe('splitCents', () => {
  it('always sums to the total and differs by at most one cent', () => {
    for (const [total, count] of [
      [1, 3],
      [1000, 3],
      [100001, 7],
      [Number.MAX_SAFE_INTEGER, 13],
    ] as const) {
      const parts = splitCents(total, count)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
    }
  })
})

describe('edge cases', () => {
  it('lets only one of many simultaneous payments with different keys win', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('no share')

    const results = await Promise.all(
      Array.from({ length: 10 }, () => pay(bill.body.id, share.id, crypto.randomUUID())),
    )

    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(9)
  })

  it('answers every simultaneous retry with the same key with 200 and one paidAt', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 700)
    const share = bill.body.shares[0]
    if (!share) throw new Error('no share')
    const key = crypto.randomUUID()

    const results = await Promise.all(
      Array.from({ length: 10 }, () => pay(bill.body.id, share.id, key)),
    )

    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(new Set(results.map((r) => r.body.paidAt)).size).toBe(1)
  })

  it('does not let a share be paid through another bill', async () => {
    const { homeId } = await createHome(['Asha'])
    const first = await createBill(homeId, 100)
    const second = await createBill(homeId, 100)
    const share = first.body.shares[0]
    if (!share) throw new Error('no share')

    const paid = await pay(second.body.id, share.id, crypto.randomUUID())

    expect(paid.status).toBe(404)
  })

  it('answers malformed JSON and bad names with a JSON error', async () => {
    const bad = await exportsFetch('{not json')
    expect(bad.status).toBe(422)
    expect(bad.body).toEqual({ error: expect.any(String) })

    const blank = await call('POST', '/api/homes', { body: { name: '   ' } })
    expect(blank.status).toBe(422)
  })

  it('returns JSON for unknown routes', async () => {
    const missing = await call('GET', '/api/nope')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: expect.any(String) })
  })
})

async function exportsFetch(rawBody: string) {
  const { exports } = await import('cloudflare:workers')
  const response = await exports.default.fetch(
    new Request('http://localhost/api/homes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    }),
  )
  return { status: response.status, body: (await response.json()) as unknown }
}
