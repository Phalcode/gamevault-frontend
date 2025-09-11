import './App.css'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LoginForm } from './components/LoginForm'
import { Avatar } from './components/Avatar'
import { TabNav } from './components/TabNav'
import { SettingsPage } from './pages/Settings'
import { AdminPage } from './pages/Admin'
import { TopIcon } from './components/TopIcon'
import { useState, useEffect } from 'react'
import { MaterialSymbolsAdminPanelSettingsOutlineRounded } from './components/admin/MaterialSymbolsAdminPanelSettingsOutlineRounded'

function Shell() {
  const { auth, bootstrapping } = useAuth()
  const [activeTab, setActiveTab] = useState('settings')

  useEffect(() => {
    if (auth) setActiveTab(prev => (prev === 'login' ? 'settings' : prev))
    else if (!bootstrapping) setActiveTab('login')
  }, [auth, bootstrapping])

  if (bootstrapping) {
    return (
      <div className="min-h-dvh grid place-items-center px-4 md:px-8 py-6 overflow-hidden">
        <div className="text-[0.85rem] opacity-80">Restoring session�</div>
      </div>
    )
  }

  if (!auth) {
    return (
      <div className="min-h-dvh grid place-items-center px-4 md:px-8 py-6 overflow-hidden">
        <LoginForm />
      </div>
    )
  }

  const tabs = [
    {
      key: 'settings',
      label: 'Settings',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09c.7 0 1.32-.4 1.51-1a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06c.48.48 1.18.63 1.82.33.58-.27 1-.87 1-1.51V3a2 2 0 0 1 4 0v.09c0 .7.4 1.32 1 1.51.64.3 1.34.15 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.48.48-.63 1.18-.33 1.82.27.58.87 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.7 0-1.32.4-1.51 1Z" />
        </svg>
      ),
    },
    {
      key: 'admin',
      label: 'Admin',
      icon: <MaterialSymbolsAdminPanelSettingsOutlineRounded width={18} height={18} />,
    },
  ]

  return (
    <div>
      <TabNav tabs={tabs} activeKey={activeTab} onChange={setActiveTab} />
      <main className="mt-0 pt-[84px] px-8 max-w-[1600px] mx-auto">
        {activeTab === 'settings' && <SettingsPage />}
        {activeTab === 'admin' && <AdminPage />}
      </main>
      <Avatar />
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <TopIcon />
      <div className="max-w-full mx-auto font-sans">
        <Shell />
      </div>
    </AuthProvider>
  )
}

export default App