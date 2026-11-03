import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { createHome, errorMessage } from '../api'

const LAST_HOME_KEY = 'lastHomeId'

export const Route = createFileRoute('/')({
  component: Landing,
})

function readLastHome(): string | null {
  try {
    return localStorage.getItem(LAST_HOME_KEY)
  } catch {
    return null
  }
}

export function rememberHome(homeId: string): void {
  try {
    localStorage.setItem(LAST_HOME_KEY, homeId)
  } catch {
    // Storage can be blocked. Remembering the home is optional.
  }
}

function Landing() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastHome = readLastHome()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const home = await createHome(name)
      rememberHome(home.id)
      await navigate({ to: '/homes/$homeId', params: { homeId: home.id } })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <main>
      <h1>Bill Splitter</h1>
      <p className="muted">Create a home, add members, then split bills between them.</p>
      <section>
        <form onSubmit={handleSubmit}>
          <label>
            Home name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create home'}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      {lastHome && (
        <p>
          <Link to="/homes/$homeId" params={{ homeId: lastHome }}>
            Continue with your last home
          </Link>
        </p>
      )}
    </main>
  )
}
