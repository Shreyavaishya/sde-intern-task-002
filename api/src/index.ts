import { Hono } from 'hono'
import { splitCents } from './split'
import { parseBillBody, parseIdempotencyKey, parseNameBody } from './validation'

type AppEnv = { Bindings: Env }

type ShareRow = {
  id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

const app = new Hono<AppEnv>()


app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'internal server error' }, 500)
})


async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const parsed = parseNameBody(await readJson(c.req.raw))
  if (!parsed.ok) return c.json({ error: parsed.error }, 422)

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
    .bind(id, parsed.value.name)
    .run()
  return c.json({ id, name: parsed.value.name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const parsed = parseNameBody(await readJson(c.req.raw))

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)
  if (!parsed.ok) return c.json({ error: parsed.error }, 422)

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, parsed.value.name)
    .run()
  return c.json({ id, homeId, name: parsed.value.name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const parsed = parseBillBody(await readJson(c.req.raw))

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)
  if (!parsed.ok) return c.json({ error: parsed.error }, 422)

  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY seq',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) return c.json({ error: 'home has no members' }, 422)

  const { title, totalCents } = parsed.value
  const billId = crypto.randomUUID()
  const amounts = splitCents(totalCents, members.length)
  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: amounts[index] ?? 0,
    paidAt: null,
  }))

  // One batch = one transaction: the bill and all its shares exist together or not at all.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const key = parseIdempotencyKey(c.req.header('Idempotency-Key'))
  if (!key.ok) return c.json({ error: key.error }, 400)

  const selectShare = c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  ).bind(shareId, billId)
  const share = await selectShare.first<ShareRow>()
  if (!share) return c.json({ error: 'share not found' }, 404)

  const toResponse = (row: ShareRow) => ({
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
  })

  // Single atomic statement: only one concurrent request can flip paid_at from NULL.
  const paidAt = new Date().toISOString()
  const update = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, key.value, shareId, billId)
    .run()

  if (update.meta.changes === 1) return c.json({ ...toResponse(share), paidAt }, 200)

  // Someone paid first. Same key = a retry (replay the stored result), other key = conflict.
  const current = await selectShare.first<ShareRow>()
  if (!current) return c.json({ error: 'share not found' }, 404)
  if (current.idempotency_key === key.value) return c.json(toResponse(current), 200)
  return c.json({ error: 'share already paid' }, 409)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name AS name,
            COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents END), 0) AS outstandingCents
       FROM members m
       LEFT JOIN shares s ON s.member_id = m.id
      WHERE m.home_id = ?
      GROUP BY m.id
      ORDER BY m.seq`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: results })
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const [bills, shares] = await c.env.DB.batch<{
    id: string
    title: string
    total_cents: number
    bill_id: string
    member_id: string
    member_name: string
    amount_cents: number
    paid_at: string | null
  }>([
    c.env.DB.prepare(
      'SELECT id, title, total_cents FROM bills WHERE home_id = ? ORDER BY seq DESC',
    ).bind(homeId),
    c.env.DB.prepare(
      `SELECT s.id, s.bill_id, s.member_id, m.name AS member_name, s.amount_cents, s.paid_at
         FROM shares s
         JOIN bills b ON b.id = s.bill_id
         JOIN members m ON m.id = s.member_id
        WHERE b.home_id = ?
        ORDER BY s.seq`,
    ).bind(homeId),
  ])

  return c.json({
    home,
    bills: (bills?.results ?? []).map((bill) => ({
      id: bill.id,
      homeId,
      title: bill.title,
      totalCents: bill.total_cents,
      shares: (shares?.results ?? [])
        .filter((share) => share.bill_id === bill.id)
        .map((share) => ({
          id: share.id,
          memberId: share.member_id,
          memberName: share.member_name,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        })),
    })),
  })
})

export default app
