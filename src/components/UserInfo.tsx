import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { AuthTokens } from '../types/api'

export function UserInfo() {
  const { auth } = useAuth()
  const [showTokens, setShowTokens] = useState(false)

  useEffect(() => {
    if (auth) console.debug('[UserInfo] auth:', auth)
  }, [auth])

  if (!auth) return null

  const displayAuth: AuthTokens | Record<string, unknown> = showTokens
    ? auth
    : {
        ...auth,
        access_token: maskValue(auth.access_token),
        refresh_token: auth.refresh_token ? maskValue(auth.refresh_token) : undefined,
      }

  return (
    <div className="data-sections">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-mini"
          onClick={() => setShowTokens(s => !s)}
        >
          {showTokens ? 'Hide tokens' : 'Show tokens'}
        </button>
      </div>

      <section>
        <h2 className="section-title">Auth Response</h2>
        <JsonBlock data={displayAuth} label="auth" />
      </section>
    </div>
  )
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  let text: string
  try {
    text = JSON.stringify(data, null, 2)
  } catch {
    text = '<< Cannot stringify >>'
  }
  return (
    <div className="json-wrapper">
      <pre className="json-block" data-label={label}>{text}</pre>
    </div>
  )
}

function maskValue(v?: string) {
  if (!v) return v
  if (v.length <= 8) return '••••'
  return v.slice(0, 4) + '•••' + v.slice(-4)
}

export default UserInfo