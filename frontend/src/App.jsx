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

function App() {
  const [pathName, setPathName] = useState(window.location.pathname)

  useEffect(() => {
    const savedTheme = localStorage.getItem('sl-lps-theme') ?? 'light'
    document.documentElement.dataset.theme = savedTheme

    if (
      ![
        DASHBOARD_PATH,
        PREDICTION_PATH,
        REPORTS_PATH,
        ALERTS_PATH,
        RAINFALL_SCENARIOS_PATH,
        SETTINGS_PATH,
      ].includes(window.location.pathname)
    ) {
      window.history.replaceState(null, '', DASHBOARD_PATH)
      setPathName(DASHBOARD_PATH)
    }
  }, [])

  useEffect(() => {
    function handlePopState() {
      setPathName(window.location.pathname)
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

  return <DashboardPage />
}

export default App
