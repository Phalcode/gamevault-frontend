import { useAuth } from '../context/AuthContext'

export function SettingsPage() {
  const { serverUrl, user } = useAuth()
  return (
    <div className="flex flex-col items-stretch min-h-0">
      <h2 className="m-0 mb-4 text-[1.65rem] font-semibold tracking-wide leading-tight">Settings</h2>
  <div className="flex flex-col rounded-[18px] border border-[#2c2b38] hover:border-accent/50 transition-colors bg-gradient-to-br from-surface to-surface-alt p-5 shadow-[0_10px_34px_-14px_rgba(0,0,0,0.55)]">
        <h3 className="mt-0 text-[0.95rem]">Session</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 mt-2 text-sm">
          <dt className="opacity-70 font-medium">Server</dt><dd>{serverUrl || '�'}</dd>
          <dt className="opacity-70 font-medium">User</dt><dd>{user?.username || '�'}</dd>
          <dt className="opacity-70 font-medium">User ID</dt><dd>{user?.id ?? user?.ID ?? '�'}</dd>
        </dl>
      </div>
    </div>
  )
}