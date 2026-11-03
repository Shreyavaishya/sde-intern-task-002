import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  addMember,
  type Balance,
  type Bill,
  createBill,
  errorMessage,
  getBalances,
  getBills,
  payShare,
  type Share,
} from '../api'
import { dollarsToCents, formatCents } from '../money'
import { rememberHome } from './index'

export const Route = createFileRoute('/homes/$homeId')({
  component: HomePage,
})

type HomeData = { name: string; bills: Bill[]; balances: Balance[] }
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: HomeData }

function HomePage() {
  const { homeId } = Route.useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const latestRequest = useRef(0)

  // `quiet` refreshes keep the current screen instead of flashing the loading state.
  const load = useCallback(
    async (quiet: boolean) => {
      const requestId = ++latestRequest.current
      if (!quiet) setState({ status: 'loading' })
      try {
        const [billsResult, balancesResult] = await Promise.all([
          getBills(homeId),
          getBalances(homeId),
        ])
        if (requestId !== latestRequest.current) return // a newer request replaced this one
        setNotice(null)
        setState({
          status: 'ready',
          data: {
            name: billsResult.home.name,
            bills: billsResult.bills,
            balances: balancesResult.balances,
          },
        })
      } catch (cause) {
        if (requestId !== latestRequest.current) return
        if (quiet) setNotice(`Could not refresh: ${errorMessage(cause)}`)
        else setState({ status: 'error', message: errorMessage(cause) })
      }
    },
    [homeId],
  )

  useEffect(() => {
    rememberHome(homeId)
    void load(false)
  }, [homeId, load])

  const refresh = useCallback(() => load(true), [load])

  if (state.status === 'loading') {
    return (
      <main>
        <p role="status">Loading…</p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main>
        <p className="error" role="alert">
          {state.message}
        </p>
        <button type="button" onClick={() => void load(false)}>
          Try again
        </button>{' '}
        <Link to="/">Back</Link>
      </main>
    )
  }

  const { name, bills, balances } = state.data

  return (
    <main>
      <p>
        <Link to="/">← All homes</Link>
      </p>
      <h1>{name}</h1>
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}

      <h2>Members</h2>
      <section>
        {balances.length === 0 ? (
          <p className="muted">No members yet. Add at least one to create a bill.</p>
        ) : (
          <ul>
            {balances.map((balance) => (
              <li className="row" key={balance.memberId}>
                <span>{balance.name}</span>
                <span className={balance.outstandingCents === 0 ? 'paid' : ''}>
                  owes {formatCents(balance.outstandingCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <AddMemberForm homeId={homeId} onDone={refresh} />
      </section>

      <h2>New bill</h2>
      <section>
        <AddBillForm homeId={homeId} disabled={balances.length === 0} onDone={refresh} />
      </section>

      <h2>Bills</h2>
      {bills.length === 0 ? (
        <p className="muted">No bills yet.</p>
      ) : (
        bills.map((bill) => (
          <div className="card" key={bill.id}>
            <strong>{bill.title}</strong>{' '}
            <span className="muted">{formatCents(bill.totalCents)}</span>
            <ul>
              {bill.shares.map((share) => (
                <ShareRow key={share.id} billId={bill.id} share={share} onChanged={refresh} />
              ))}
            </ul>
          </div>
        ))
      )}
    </main>
  )
}

function ShareRow({
  billId,
  share,
  onChanged,
}: {
  billId: string
  share: Share
  onChanged: () => Promise<void>
}) {
  // One key per payment attempt. It is reused when the user retries after a failure, so a
  // request that actually succeeded (but whose answer got lost) can never charge twice.
  const keyRef = useRef<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePay() {
    if (pending) return
    keyRef.current ??= crypto.randomUUID()
    setPending(true)
    setError(null)
    try {
      await payShare(billId, share.id, keyRef.current)
      keyRef.current = null
      await onChanged()
    } catch (cause) {
      // The share stays unpaid on screen: we only mark it paid after the server confirms.
      setError(errorMessage(cause))
      if (cause instanceof ApiError && cause.status === 409) {
        keyRef.current = null
        await onChanged() // someone else paid it, show the real state
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="row">
      <span>
        {share.memberName} <span className="muted">{formatCents(share.amountCents)}</span>
      </span>
      <span>
        {share.paidAt ? (
          <span className="paid">Paid {new Date(share.paidAt).toLocaleDateString()}</span>
        ) : (
          <button type="button" onClick={handlePay} disabled={pending}>
            {pending ? 'Paying…' : error ? 'Retry payment' : 'Pay'}
          </button>
        )}
        {error && (
          <span className="error" role="alert">
            {' '}
            {error}
          </span>
        )}
      </span>
    </li>
  )
}

function AddMemberForm({ homeId, onDone }: { homeId: string; onDone: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await addMember(homeId, name)
      setName('')
      await onDone()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <label>
          Member name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add member'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

function AddBillForm({
  homeId,
  disabled,
  onDone,
}: {
  homeId: string
  disabled: boolean
  onDone: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const totalCents = dollarsToCents(amount)
    if (totalCents === null) {
      setError('Enter an amount above zero with at most 2 decimals, for example 10.50')
      return
    }
    setPending(true)
    setError(null)
    try {
      await createBill(homeId, title, totalCents)
      setTitle('')
      setAmount('')
      await onDone()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label>
          Amount ($)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <button type="submit" disabled={pending || disabled}>
          {pending ? 'Splitting…' : 'Split bill'}
        </button>
      </form>
      {disabled && <p className="muted">Add a member first.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
