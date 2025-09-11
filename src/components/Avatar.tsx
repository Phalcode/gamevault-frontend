import { useAuth } from '../context/AuthContext'
import { useEffect, useState, useRef, useCallback } from 'react'

export function Avatar() {
  const { user, auth, serverUrl, logout, loading } = useAuth()
  const imageId = user?.avatar?.ID ?? user?.avatar?.id
  const accessToken = auth?.access_token
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const revokeRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (revokeRef.current) URL.revokeObjectURL(revokeRef.current)
    }
  }, [])

  useEffect(() => {
    if (revokeRef.current) {
      URL.revokeObjectURL(revokeRef.current)
      revokeRef.current = null
    }
    setBlobUrl(null)
    setError(null)
    if (!imageId || !serverUrl) return
    let cancelled = false
    ;(async () => {
      try {
        const base = serverUrl.replace(/\/+$/, '')
        const mediaUrl = `${base}/api/media/${imageId}`
        const res = await fetch(mediaUrl, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })
        if (!res.ok) throw new Error(`Avatar fetch failed (${res.status})`)
        const blob = await res.blob()
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        revokeRef.current = url
        setBlobUrl(url)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [imageId, serverUrl, accessToken])

  const handleLogout = useCallback(() => {
    logout()
  }, [logout])

  if (!auth) return null

  return (
    <div style={containerStyle}>
      <div style={avatarShellStyle} title={error || (imageId ? `Media ID: ${imageId}` : 'User')}>
        {!blobUrl && !error && <div style={loadingStyle} />}
        {error && <div style={errorStyle}>!</div>}
        {blobUrl && !error && (
            <img
              src={blobUrl}
              alt={user?.username ? `${user.username} avatar` : 'User Avatar'}
              style={imgStyle}
              draggable={false}
            />
        )}
      </div>
      <button
        type="button"
        onClick={handleLogout}
        style={logoutBtnStyle as React.CSSProperties}
        disabled={loading}
        aria-label="Log out"
        title="Log out"
      >
        <span style={{ lineHeight: 0, display: 'flex' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v3" />
            <path d="M21 16v3a2 2 0 0 1-2 2h-4" />
            <path d="M10 12h12" />
            <path d="M15 17 10 12l5-5" />
            <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
          </svg>
        </span>
        <span className="logout-label">Logout</span>
      </button>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 10,
  left: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  zIndex: 1550,
}

const avatarShellStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  padding: 4,
  background: 'rgba(17,16,30,0.6)',
  border: '1px solid #2e2d3b',
  borderRadius: 16,
  boxShadow: '0 4px 14px -4px rgba(0,0,0,.6)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const imgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  borderRadius: 12,
}

const loadingStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  borderRadius: 12,
  background: 'linear-gradient(110deg,#232230 8%,#2d2c3a 18%,#232230 33%)',
  backgroundSize: '200% 100%',
  animation: 'avatar-shimmer 1.2s linear infinite',
}

const errorStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  borderRadius: 12,
  background: '#5b2525',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontFamily: 'monospace',
}

const logoutBtnStyle: Partial<CSSStyleDeclaration> = {
  background: 'linear-gradient(140deg,#6459DF,#4d42c3)',
  border: '1px solid #4e45c1',
  color: '#fff',
  fontSize: '.75rem',
  fontWeight: '600',
  letterSpacing: '.6px',
  padding: '0.85rem 1rem 0.75rem',
  borderRadius: '14px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  boxShadow: '0 4px 14px -6px rgba(0,0,0,.55), 0 2px 6px -2px rgba(0,0,0,.5)',
  backdropFilter: 'blur(6px)',
  transition: 'background .18s ease, transform .14s ease, box-shadow .2s ease',
}