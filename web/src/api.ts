const REQUEST_TIMEOUT_MS = 10_000

export type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }
export type BillsResponse = { home: { id: string; name: string }; bills: Bill[] }

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

function readErrorField(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const value = (data as { error: unknown }).error
    if (typeof value === 'string') return value
  }
  return null
}

/** fetch with a timeout. Every failure (network, timeout, 4xx, 5xx, bad JSON) becomes an ApiError. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(path, { ...init, signal: controller.signal })
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === 'AbortError'
    throw new ApiError(
      0,
      timedOut ? 'The server took too long to answer' : 'Cannot reach the server',
    )
  } finally {
    clearTimeout(timer)
  }

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // Non-JSON body (for example a proxy error page). Handled below.
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorField(data) ?? `Request failed (${response.status})`,
    )
  }
  if (data === null) throw new ApiError(response.status, 'The server sent an unreadable answer')
  return data as T
}

function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

export const createHome = (name: string) =>
  post<{ id: string; name: string }>('/api/homes', { name })

export const addMember = (homeId: string, name: string) =>
  post<{ id: string }>(`/api/homes/${encodeURIComponent(homeId)}/members`, { name })

export const createBill = (homeId: string, title: string, totalCents: number) =>
  post<{ id: string }>(`/api/homes/${encodeURIComponent(homeId)}/bills`, { title, totalCents })

export const getBills = (homeId: string) =>
  request<BillsResponse>(`/api/homes/${encodeURIComponent(homeId)}/bills`)

export const getBalances = (homeId: string) =>
  request<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(homeId)}/balances`)

export const payShare = (billId: string, shareId: string, idempotencyKey: string) =>
  post<{ id: string; paidAt: string }>(
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    {},
    { 'Idempotency-Key': idempotencyKey },
  )
