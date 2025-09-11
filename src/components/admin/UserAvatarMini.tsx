import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { User } from '../../types/api'

interface Props {
  media?: User['avatar']
  serverUrl?: string
}

export function UserAvatarMini({ media, serverUrl }: Props) {
  const imageId = media?.ID ?? (media as any)?.id
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const revokeRef = useRef<string | null>(null)
  const { authFetch } = useAuth()

  useEffect(() => () => {
    if (revokeRef.current) URL.revokeObjectURL(revokeRef.current)
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
        const res = await authFetch(mediaUrl)
        if (!res.ok) throw new Error(`Media fetch failed (${res.status})`)
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
  }, [imageId, serverUrl, authFetch])

  return (
    <div style={styles.shell} title={error || (imageId ? `Media ID: ${imageId}` : 'No avatar')}>
      {!blobUrl && !error && <div style={styles.loading} />}
      {error && <div style={styles.error}>!</div>}
      {blobUrl && !error && (
        <img src={blobUrl} alt="User avatar" style={styles.img} draggable={false} />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    width: 48, height: 48, padding: 3, background: 'rgba(17,16,30,0.6)', border: '1px solid #2e2d3b',
    borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flex: '0 0 auto',
  },
  img: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 },
  loading: {
    width: '100%', height: '100%', borderRadius: 10,
    background: 'linear-gradient(110deg,#232230 8%,#2d2c3a 18%,#232230 33%)',
    backgroundSize: '200% 100%', animation: 'avatar-shimmer 1.2s linear infinite',
  },
  error: {
    width: '100%', height: '100%', borderRadius: 10, background: '#5b2525',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem',
  },
}