const MAX_NAME_LENGTH = 100
const MAX_KEY_LENGTH = 255

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseText(value: unknown, field: string): Parsed<string> {
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: false, error: `${field} must not be empty` }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `${field} must be at most ${MAX_NAME_LENGTH} characters` }
  }
  return { ok: true, value: trimmed }
}

export function parseNameBody(body: unknown): Parsed<{ name: string }> {
  if (!isRecord(body)) return { ok: false, error: 'body must be a JSON object' }
  const name = parseText(body.name, 'name')
  return name.ok ? { ok: true, value: { name: name.value } } : name
}

export function parseBillBody(body: unknown): Parsed<{ title: string; totalCents: number }> {
  if (!isRecord(body)) return { ok: false, error: 'body must be a JSON object' }
  const title = parseText(body.title, 'title')
  if (!title.ok) return title
  const total = body.totalCents
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) {
    return { ok: false, error: 'totalCents must be a positive whole number of cents' }
  }
  return { ok: true, value: { title: title.value, totalCents: total } }
}

export function parseIdempotencyKey(header: string | undefined): Parsed<string> {
  const key = header?.trim()
  if (!key) return { ok: false, error: 'Idempotency-Key header is required' }
  if (key.length > MAX_KEY_LENGTH) {
    return { ok: false, error: `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters` }
  }
  return { ok: true, value: key }
}
