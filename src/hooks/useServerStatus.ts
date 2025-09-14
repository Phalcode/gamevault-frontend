import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'

export interface ServerInfo {
  status: string
  version: string
  registration_enabled: boolean
  required_registration_fields: string[]
  available_authentication_methods: string[]
}

interface UseServerStatusResult {
  info: ServerInfo | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useServerStatus(): UseServerStatusResult {
  const { serverUrl } = useAuth()
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!serverUrl) return
    const base = serverUrl.replace(/\/+$/, '')
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`${base}/api/status`, { headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(`Status failed (${res.status}): ${(await res.text()) || res.statusText}`)
        const data = await res.json()
        if (!cancelled) setInfo(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [serverUrl, nonce])

  return { info, loading, error, refresh }
}
