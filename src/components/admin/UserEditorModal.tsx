import { useEffect, useMemo, useRef, useState } from 'react'
import { User } from '@/types/api'
import { useAuth } from '@/context/AuthContext'

interface Props {
  user: User
  onClose: () => void
  onSave: (payload: {
    username: string
    email: string
    first_name: string
    last_name: string
    password?: string
    birth_date: string | null
  }) => Promise<{ ok: boolean; message?: string }>
  onUserUpdated?: (u: User) => void
}

type TabKey = 'images' | 'details'

// NOTE: This is a direct port from old-src with minimal stylistic changes to avoid black screen issues.
export function UserEditorModal({ user, onClose, onSave, onUserUpdated }: Props) {
  const { serverUrl, authFetch } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('images')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const birthRaw = user.birth_date ?? (user as any).BirthDate
  let birthISO = ''
  if (birthRaw) {
    const d = new Date(birthRaw as any)
    if (!isNaN(d.getTime())) birthISO = d.toISOString().slice(0, 10)
  }

  const [form, setForm] = useState({
    username: user.username || (user as any).Username || '',
    email: user.email || (user as any).EMail || '',
    first_name: user.first_name || (user as any).FirstName || '',
    last_name: user.last_name || (user as any).LastName || '',
    password: '',
    birth_date: birthISO,
  })

  const hasChanges = useMemo(() => {
    const orig = {
      username: user.username || (user as any).Username || '',
      email: user.email || (user as any).EMail || '',
      first_name: user.first_name || (user as any).FirstName || '',
      last_name: user.last_name || (user as any).LastName || '',
      birth_date: birthISO,
    }
    if (form.password.trim().length > 0) return true
    return Object.keys(orig).some((k) => (orig as any)[k] !== (form as any)[k])
  }, [form, user, birthISO])

  const onInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    setSaveMsg(null)
  }

  const handleSubmit = async () => {
    if (!hasChanges || saving) return
    setSaving(true)
    setSaveMsg(null)
    const payload = {
      username: form.username,
      email: form.email,
      first_name: form.first_name,
      last_name: form.last_name,
      birth_date: form.birth_date || null,
      password: form.password.trim() || undefined,
    }
    const res = await onSave(payload)
    if (res.ok) {
      setForm((f) => ({ ...f, password: '' }))
      setSaveMsg('Successfully saved User details')
    } else {
      setSaveMsg(res.message || 'Unknown error')
    }
    setSaving(false)
  }

  interface ImageState {
    file: File | null
    via: 'none' | 'file' | 'url' | 'paste' | 'drag'
    preview: string | null
    urlInput: string
    original: string | null
    loadedId?: number | null
  }

  const [avatarImg, setAvatarImg] = useState<ImageState>({
    file: null,
    via: 'none',
    preview: null,
    urlInput: '',
    original: null,
    loadedId: undefined,
  })
  const [bgImg, setBgImg] = useState<ImageState>({
    file: null,
    via: 'none',
    preview: null,
    urlInput: '',
    original: null,
    loadedId: undefined,
  })

  const [savingImages, setSavingImages] = useState(false)
  const [imagesMsg, setImagesMsg] = useState<string | null>(null)

  const revokeRef = useRef<string[]>([])
  useEffect(() => () => {
    revokeRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u)
      } catch {}
    })
  }, [])

  const avatarMediaId = (user.avatar as any)?.ID ?? (user.avatar as any)?.id ?? (user as any).avatar_id
  const backgroundMediaId = (user.background as any)?.ID ?? (user.background as any)?.id ?? (user as any).background_id

  const fetchMediaBlobUrl = async (id: number): Promise<string | null> => {
    if (!serverUrl || !id) return null
    try {
      const base = serverUrl.replace(/\/+$/, '')
      const res = await authFetch(`${base}/api/media/${id}`)
      if (!res.ok) throw new Error(`media ${id} ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      revokeRef.current.push(url)
      return url
    } catch {
      return null
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (avatarMediaId && avatarImg.original == null) {
        const url = await fetchMediaBlobUrl(Number(avatarMediaId))
        if (!cancelled && url) {
          setAvatarImg((s) => ({ ...s, preview: url, original: url, loadedId: Number(avatarMediaId) }))
        }
      }
      if (backgroundMediaId && bgImg.original == null) {
        const url = await fetchMediaBlobUrl(Number(backgroundMediaId))
        if (!cancelled && url) {
          setBgImg((s) => ({ ...s, preview: url, original: url, loadedId: Number(backgroundMediaId) }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [avatarMediaId, backgroundMediaId, user])

  const isProbablyImageUrl = (v: string) => /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(v.trim())

  const loadFile = (file: File, target: 'avatar' | 'bg', via: ImageState['via']) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    revokeRef.current.push(url)
    const update = { file, via, preview: url }
    if (target === 'avatar') setAvatarImg((prev) => ({ ...prev, ...update }))
    else setBgImg((prev) => ({ ...prev, ...update }))
  }

  const loadUrl = (url: string, target: 'avatar' | 'bg') => {
    if (!url.trim()) return
    const safe = url.trim()
    const update = { file: null, via: 'url' as const, preview: safe }
    if (target === 'avatar') setAvatarImg((prev) => ({ ...prev, ...update, urlInput: safe }))
    else setBgImg((prev) => ({ ...prev, ...update, urlInput: safe }))
  }

  const handlePaste = (e: React.ClipboardEvent, target: 'avatar' | 'bg') => {
    const items = e.clipboardData?.items
    if (items) {
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) {
            loadFile(f, target, 'paste')
            e.preventDefault()
            return
          }
        }
      }
    }
    const text = e.clipboardData?.getData('text')
    if (text && isProbablyImageUrl(text)) {
      loadUrl(text, target)
      e.preventDefault()
    }
  }

  const handleDrop = (e: React.DragEvent, target: 'avatar' | 'bg') => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) loadFile(f, target, 'drag')
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  const avatarFileInputRef = useRef<HTMLInputElement | null>(null)
  const bgFileInputRef = useRef<HTMLInputElement | null>(null)

  const imagesDirty = avatarImg.preview !== avatarImg.original || bgImg.preview !== bgImg.original

  const obtainFileForState = async (state: ImageState, fallbackName: string): Promise<File | null> => {
    if (state.file) return state.file
    if (state.via === 'url' && state.preview) {
      try {
        const r = await fetch(state.preview)
        if (!r.ok) throw new Error('url fetch failed')
        const b = await r.blob()
        const ext = (b.type && b.type.split('/')[1]) || 'png'
        return new File([b], `${fallbackName}.${ext}`, { type: b.type || 'image/png' })
      } catch {
        return null
      }
    }
    return null
  }

  const uploadImage = async (file: File): Promise<number> => {
    if (!serverUrl) throw new Error('No server URL')
    const base = serverUrl.replace(/\/+$/, '')
    const formData = new FormData()
    formData.append('file', file, file.name)
    const res = await authFetch(`${base}/api/media`, { method: 'POST', body: formData })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Upload failed (${res.status}): ${txt || res.statusText}`)
    }
    const media = await res.json()
    const mid = media?.id ?? media?.ID
    if (!mid) throw new Error('Upload response missing id')
    return mid
  }

  const saveImages = async () => {
    if (!imagesDirty || savingImages) return
    setSavingImages(true)
    setImagesMsg(null)
    try {
      const newAvatar = avatarImg.preview !== avatarImg.original
      const newBg = bgImg.preview !== bgImg.original
      let avatarId: number | undefined
      let backgroundId: number | undefined

      if (newAvatar) {
        const file = await obtainFileForState(avatarImg, 'avatar')
        if (!file) throw new Error('Invalid avatar image')
        avatarId = await uploadImage(file)
      }
      if (newBg) {
        const file = await obtainFileForState(bgImg, 'background')
        if (!file) throw new Error('Invalid background image')
        backgroundId = await uploadImage(file)
      }

      if (avatarId || backgroundId) {
        const uid = (user as any).id ?? (user as any).ID
        if (!uid) throw new Error('User has no ID')
        const base = serverUrl?.replace(/\/+$/, '')
        const payload: any = { ...user }
        if (avatarId) payload.avatar_id = avatarId
        if (backgroundId) payload.background_id = backgroundId
        delete (payload as any).avatar
        delete (payload as any).background

        const res = await authFetch(`${base}/api/users/${uid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) {
          const txt = await res.text()
          throw new Error(`User update failed (${res.status}): ${txt || res.statusText}`)
        }
        const updatedUser = await res.json()
        onUserUpdated?.(updatedUser)
      }

      setImagesMsg('Images saved successfully')
      if (newAvatar) {
        setAvatarImg((s) => ({ ...s, original: s.preview, via: 'none', file: null, urlInput: '', loadedId: avatarId ?? s.loadedId }))
      }
      if (newBg) {
        setBgImg((s) => ({ ...s, original: s.preview, via: 'none', file: null, urlInput: '', loadedId: backgroundId ?? s.loadedId }))
      }
    } catch (e: any) {
      setImagesMsg(e?.message || 'Failed to save images')
    } finally {
      setSavingImages(false)
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal} role="dialog" aria-modal="true" aria-labelledby="user-settings-title">
        <div style={styles.header}>
          <h3 id="user-settings-title" style={{ margin: 0, fontSize: '1.05rem', letterSpacing: '.5px' }}>User Settings</h3>
          <button type="button" onClick={onClose} style={styles.closeBtn} disabled={saving || savingImages} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" /><path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" /></svg>
          </button>
        </div>
        <div style={styles.tabBar}>
          <button type="button" onClick={() => setActiveTab('images')} style={tabButtonStyle(activeTab === 'images')}>Edit Images</button>
          <button type="button" onClick={() => setActiveTab('details')} style={tabButtonStyle(activeTab === 'details')}>Edit Details</button>
        </div>
        <div style={styles.scrollArea}>
          {activeTab === 'images' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28, padding: '2px 4px 12px' }}>
              <div style={imageStyles.zonesRow}>
                <div onPaste={(e) => handlePaste(e, 'avatar')} onDrop={(e) => handleDrop(e, 'avatar')} onDragOver={handleDragOver} style={imageZoneStyle(avatarImg.preview)}>
                  <div style={imageStyles.zoneHeader}>
                    <span style={imageStyles.zoneTitle}>Avatar</span>
                    {avatarImg.via !== 'none' && (<span style={imageStyles.badge}>{avatarImg.via}</span>)}
                  </div>
                  <div style={imageStyles.previewWrap} onClick={() => avatarFileInputRef.current?.click()} tabIndex={0} role="button" aria-label="Upload avatar image">
                    {avatarImg.preview ? <img src={avatarImg.preview} alt="Avatar preview" style={imageStyles.previewImg} draggable={false} /> : <div style={imageStyles.emptyMsg}><span>{avatarMediaId ? 'Loading…' : 'Drag & Drop / Click / Paste'}</span></div>}
                  </div>
                  <div style={imageStyles.urlBoxWrap}>
                    <input type="text" placeholder="Paste image URL" value={avatarImg.urlInput} onChange={(e) => setAvatarImg((p) => ({ ...p, urlInput: e.target.value }))} style={styles.input} />
                    {avatarImg.preview && avatarImg.preview !== avatarImg.original && (
                      <button type="button" style={miniBtnStyle(false)} onClick={() => setAvatarImg((p) => ({ ...p, file: null, via: 'none', preview: p.original, urlInput: '' }))}>Reset</button>
                    )}
                  </div>
                  <input ref={avatarFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f, 'avatar', 'file'); e.target.value = '' }} />
                </div>
                <div onPaste={(e) => handlePaste(e, 'bg')} onDrop={(e) => handleDrop(e, 'bg')} onDragOver={handleDragOver} style={imageZoneStyle(bgImg.preview)}>
                  <div style={imageStyles.zoneHeader}>
                    <span style={imageStyles.zoneTitle}>Background</span>
                    {bgImg.via !== 'none' && (<span style={imageStyles.badge}>{bgImg.via}</span>)}
                  </div>
                  <div style={{ ...imageStyles.previewWrap, height: 220 }} onClick={() => bgFileInputRef.current?.click()} tabIndex={0} role="button" aria-label="Upload background image">
                    {bgImg.preview ? <img src={bgImg.preview} alt="Background preview" style={{ ...imageStyles.previewImg, objectFit: 'cover' }} draggable={false} /> : <div style={imageStyles.emptyMsg}><span>{backgroundMediaId ? 'Loading…' : 'Drag & Drop / Click / Paste'}</span></div>}
                  </div>
                  <div style={imageStyles.urlBoxWrap}>
                    <input type="text" placeholder="Paste image URL" value={bgImg.urlInput} onChange={(e) => setBgImg((p) => ({ ...p, urlInput: e.target.value }))} style={styles.input} />
                    {bgImg.preview && bgImg.preview !== bgImg.original && (
                      <button type="button" style={miniBtnStyle(false)} onClick={() => setBgImg((p) => ({ ...p, file: null, via: 'none', preview: p.original, urlInput: '' }))}>Reset</button>
                    )}
                  </div>
                  <input ref={bgFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f, 'bg', 'file'); e.target.value = '' }} />
                </div>
              </div>
              <div style={imageStyles.footerRow}>
                <div style={{ flex: 1 }}>{imagesMsg && (<div style={{ fontSize: '.65rem', color: imagesMsg.toLowerCase().includes('success') ? '#6fe39e' : '#ffb3b3' }}>{imagesMsg}</div>)}</div>
                <button type="button" onClick={saveImages} disabled={!imagesDirty || savingImages} style={saveButtonStyle(!imagesDirty || savingImages)}>{savingImages ? 'Saving Images…' : 'Save Images'}</button>
              </div>
            </div>
          )}
          {activeTab === 'details' && (
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} style={styles.formGrid}>
              {[{ name: 'username', label: 'Username', type: 'text' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'first_name', label: 'First name', type: 'text' }, { name: 'last_name', label: 'Last name', type: 'text' }, { name: 'password', label: 'Password', type: 'password', placeholder: 'new password' }, { name: 'birth_date', label: 'Birth date', type: 'date' }].map((f) => (
                <div key={f.name} style={styles.fieldCell}>
                  <label style={styles.label}>
                    <span style={styles.labelText}>{f.label}</span>
                    <input name={f.name} type={f.type} value={(form as any)[f.name]} onChange={onInput} style={styles.input} autoComplete={f.name === 'password' ? 'new-password' : 'off'} placeholder={(f as any).placeholder} />
                  </label>
                </div>
              ))}
              <div style={styles.formFooterRow}>
                <div style={{ flex: 1 }}>{saveMsg && (<div style={{ fontSize: '.65rem', color: saveMsg.startsWith('Successfully') ? '#6fe39e' : '#ffb3b3', paddingLeft: 2 }}>{saveMsg}</div>)}</div>
                <button type="submit" disabled={!hasChanges || saving} style={saveButtonStyle(!hasChanges || saving)}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(10,10,18,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 3vw', zIndex: 400, overflowY: 'auto', overflowX: 'hidden' },
  modal: { width: '860px', maxWidth: '96vw', background: 'linear-gradient(155deg,#2b2a3c 0%,#222130 55%,#1c1b28 100%)', border: '1px solid #38384a', borderRadius: 24, boxShadow: '0 10px 48px -12px rgba(0,0,0,.75), 0 2px 6px -2px rgba(0,0,0,.6)', padding: '28px 34px 32px', position: 'relative', color: '#e8e8f4', display: 'flex', flexDirection: 'column', maxHeight: '88vh', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  closeBtn: { background: 'linear-gradient(140deg,#3a3950,#343348)', border: '1px solid #4a4960', color: '#d8d8e6', width: 40, height: 40, borderRadius: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  tabBar: { display: 'flex', gap: 12, padding: '4px 2px 14px 2px', borderBottom: '1px solid #323244', flex: '0 0 auto' },
  scrollArea: { marginTop: 18, overflowY: 'auto', overflowX: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', gap: 24, padding: '0 4px 0 2px', scrollbarWidth: 'thin' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '28px 48px', alignItems: 'start', padding: '2px 6px 4px 2px', boxSizing: 'border-box' },
  fieldCell: { display: 'flex', flexDirection: 'column' },
  label: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: '.62rem', letterSpacing: '.55px', fontWeight: 600, color: '#bfbfd3' },
  labelText: { paddingLeft: 2, textTransform: 'uppercase', opacity: 0.9 },
  input: { background: 'linear-gradient(120deg,#1f1e2a,#232231)', border: '1px solid #3f4054', borderRadius: 14, padding: '12px 14px', color: '#ececf6', fontSize: '.78rem', outline: 'none', width: '100%', lineHeight: 1.25, boxSizing: 'border-box' },
  formFooterRow: { gridColumn: '1 / -1', marginTop: 4, display: 'flex', alignItems: 'center', gap: 16, paddingTop: 6 },
}

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: '0 0 auto',
  background: active ? 'linear-gradient(120deg,#5c53d8,#7169ff)' : 'linear-gradient(120deg,#2f2e42,#2a293a)',
  border: '1px solid ' + (active ? '#6d63f0' : '#3f3e52'),
  color: active ? '#fff' : '#d2d2e4',
  fontSize: '.72rem',
  letterSpacing: '.7px',
  fontWeight: 600,
  padding: '11px 20px',
  borderRadius: 14,
  cursor: 'pointer',
  transition: 'background .25s, border-color .25s',
})

const saveButtonStyle = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? 'linear-gradient(120deg,#404058,#3a3a50)' : 'linear-gradient(120deg,#5c53d8,#786fff)',
  border: '1px solid ' + (disabled ? '#4a4a62' : '#7a72ff'),
  color: disabled ? '#9b9ab0' : '#fff',
  fontSize: '.74rem',
  letterSpacing: '.85px',
  fontWeight: 600,
  padding: '13px 30px',
  borderRadius: 16,
  cursor: disabled ? 'default' : 'pointer',
  minWidth: 140,
})

const imageStyles: Record<string, React.CSSProperties> = {
  zonesRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 34 },
  zoneHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  zoneTitle: { fontSize: '.65rem', letterSpacing: '.6px', textTransform: 'uppercase', fontWeight: 600, color: '#bfc0d4' },
  badge: { fontSize: '.55rem', letterSpacing: '.6px', padding: '4px 8px', borderRadius: 999, background: '#3c3b52', color: '#d8d8ea', textTransform: 'uppercase' },
  previewWrap: { position: 'relative', borderRadius: 18, border: '1px dashed #4a4a60', background: 'linear-gradient(145deg,#252432,#1f1e29)', height: 160, overflow: 'hidden', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color .25s, background .25s' },
  previewImg: { maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  emptyMsg: { fontSize: '.62rem', letterSpacing: '.55px', opacity: 0.65, textAlign: 'center', padding: '0 12px', lineHeight: 1.3 },
  urlBoxWrap: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 },
  footerRow: { display: 'flex', alignItems: 'center', gap: 18, justifyContent: 'flex-end', paddingTop: 4 },
}

const imageZoneStyle = (hasPreview: string | null): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', background: 'linear-gradient(150deg,#2a293b,#252432)', border: '1px solid #38384c', padding: '18px 20px 20px', borderRadius: 22, position: 'relative', minHeight: 270, boxShadow: '0 4px 14px -6px rgba(0,0,0,.55)', ...(hasPreview ? {} : { outline: '1px dashed rgba(120,120,150,.15)' }),
})

const miniBtnStyle = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? 'linear-gradient(120deg,#3b3b52,#353448)' : 'linear-gradient(120deg,#5c53d8,#6e65f0)',
  border: '1px solid ' + (disabled ? '#47475e' : '#6e66f5'),
  color: disabled ? '#a4a4ba' : '#ffffff',
  fontSize: '.6rem',
  letterSpacing: '.6px',
  fontWeight: 600,
  padding: '10px 16px',
  borderRadius: 14,
  cursor: disabled ? 'default' : 'pointer',
  flex: '0 0 auto',
  minWidth: 70,
  transition: 'background .25s, border-color .25s',
})
