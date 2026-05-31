import { useEffect, useState } from 'react'
import DashboardPage from './admin/dashboard.jsx'
import PredictionPage from './admin/prediction.jsx'
import ReportsPage from './admin/reports.jsx'
import AlertsPage from './admin/alerts.jsx'
import RainfallScenariosPage from './admin/rainfall-scenarios.jsx'
import SettingsPage from './admin/settings.jsx'

const DASHBOARD_PATH = '/admin/dashboard'
const PREDICTION_PATH = '/admin/prediction'
const REPORTS_PATH = '/admin/reports'
const ALERTS_PATH = '/admin/alerts'
const RAINFALL_SCENARIOS_PATH = '/admin/rainfall-scenarios'
const SETTINGS_PATH = '/admin/settings'
const HOME_PATH = '/'
const LOGOUT_PATH = '/logout'
const LANDING_TEMPLATE_PATH = '/nexusai-1.0.0/index.html'
const AUTH_USER_KEY = 'sl-lps-auth-user'
const AUTH_TOKEN_KEY = 'sl-lps-auth-token'
const ADMIN_PATHS = [
  DASHBOARD_PATH,
  PREDICTION_PATH,
  REPORTS_PATH,
  ALERTS_PATH,
  RAINFALL_SCENARIOS_PATH,
  SETTINGS_PATH,
]

function parseJwtPayload(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      '=',
    )

    return JSON.parse(window.atob(paddedPayload))
  } catch (_) {
    return null
  }
}

function hasValidAdminSession() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  if (!token) return false

  const payload = parseJwtPayload(token)
  if (!payload || payload.role !== 'admin') return false

  const expiresAt = Number(payload.exp) * 1000
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_USER_KEY)
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

function resolvePath(pathName: string) {
  if (pathName === LOGOUT_PATH) {
    clearAuthSession()
    window.history.replaceState(null, '', HOME_PATH)
    return HOME_PATH
  }

  if (!pathName.startsWith('/admin')) {
    return pathName
  }

  if (!hasValidAdminSession()) {
    clearAuthSession()
    window.history.replaceState(null, '', HOME_PATH)
    return HOME_PATH
  }

  if (!ADMIN_PATHS.includes(pathName)) {
    window.history.replaceState(null, '', DASHBOARD_PATH)
    return DASHBOARD_PATH
  }

  return pathName
}

function LandingPage() {
  return (
    <iframe
      src={LANDING_TEMPLATE_PATH}
      title="Southern Leyte Landslide Prediction landing page"
      style={{
        border: 0,
        display: 'block',
        height: '100vh',
        width: '100vw',
      }}
    />
  )
}

function App() {
  const [pathName, setPathName] = useState(() => resolvePath(window.location.pathname))

  useEffect(() => {
    const savedTheme = localStorage.getItem('sl-lps-theme') ?? 'light'
    document.documentElement.dataset.theme = savedTheme
    setPathName(resolvePath(window.location.pathname))
  }, [])

  useEffect(() => {
    function handlePopState() {
      setPathName(resolvePath(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (pathName === PREDICTION_PATH) {
    return <PredictionPage />
  }

  if (pathName === REPORTS_PATH) {
    return <ReportsPage />
  }

  if (pathName === ALERTS_PATH) {
    return <AlertsPage />
  }

  if (pathName === RAINFALL_SCENARIOS_PATH) {
    return <RainfallScenariosPage />
  }

  if (pathName === SETTINGS_PATH) {
    return <SettingsPage />
  }

  if (pathName === DASHBOARD_PATH) {
    return <DashboardPage />
  }

  return <LandingPage />
}

export default App
