import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'
import { API_BASE_URL, applyTheme, getStoredTheme, saveTheme } from './theme-settings'

function SettingsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const apiHasConnectedRef = useRef(false)
  const [dbStatus, setDbStatus] = useState('checking')
  const [modelStatus, setModelStatus] = useState('checking')
  const [themeMode, setThemeMode] = useState(
    getStoredTheme,
  )
  const [exportFormat, setExportFormat] = useState('GeoJSON')
  const [dataScope, setDataScope] = useState('Risk Zones')
  const [defaultMunicipality, setDefaultMunicipality] = useState('Bontoc')
  const [defaultRainfall, setDefaultRainfall] = useState(120)
  const [defaultDuration, setDefaultDuration] = useState(6)
  const [mapInteraction, setMapInteraction] = useState('Locked by default')
  const [settingsStatus, setSettingsStatus] = useState('loading')
  const [exportStatus, setExportStatus] = useState('idle')
  const [metadataStatus, setMetadataStatus] = useState('loading')
  const [controlStatus, setControlStatus] = useState({})
  const [metadata, setMetadata] = useState(null)

  function markApiConnected() {
    apiHasConnectedRef.current = true
    setApiStatus('connected')
  }

  function applySettings(settings) {
    if (!settings) {
      return
    }

    setThemeMode(settings.theme_mode ?? 'light')
    setExportFormat(settings.export_format ?? 'GeoJSON')
    setDataScope(settings.data_scope ?? 'Risk Zones')
    setDefaultMunicipality(settings.default_municipality ?? 'Bontoc')
    setDefaultRainfall(settings.default_rainfall ?? 120)
    setDefaultDuration(settings.default_duration ?? 6)
    setMapInteraction(settings.map_interaction ?? 'Locked by default')
  }

  function loadSettings() {
    setSettingsStatus('loading')

    return axios
      .get(`${API_BASE_URL}/system-settings`)
      .then((response) => {
        markApiConnected()
        applySettings(response.data?.settings)
        setSettingsStatus('saved')
      })
      .catch(() => setSettingsStatus('failed'))
  }

  function refreshMetadata() {
    setMetadataStatus('loading')

    return axios
      .get(`${API_BASE_URL}/system-settings/metadata`)
      .then((response) => {
        markApiConnected()
        setMetadata(response.data)
        setMetadataStatus('loaded')
      })
      .catch(() => setMetadataStatus('failed'))
  }

  function saveSettings(overrides = {}) {
    const payload = {
      theme_mode: themeMode,
      export_format: exportFormat,
      data_scope: dataScope,
      default_municipality: defaultMunicipality,
      default_rainfall: Number(defaultRainfall),
      default_duration: Number(defaultDuration),
      map_interaction: mapInteraction,
      ...overrides,
    }

    setSettingsStatus('saving')

    return axios
      .put(`${API_BASE_URL}/system-settings`, payload)
      .then((response) => {
        applySettings(response.data?.settings)
        setSettingsStatus('saved')
      })
      .then(() => refreshMetadata())
      .catch(() => setSettingsStatus('failed'))
  }

  function runControl(action) {
    setControlStatus((status) => ({ ...status, [action]: 'running' }))

    return axios
      .post(`${API_BASE_URL}/system-controls/${action}`)
      .then(() => {
        setControlStatus((status) => ({ ...status, [action]: 'done' }))
        return refreshMetadata()
      })
      .catch(() =>
        setControlStatus((status) => ({ ...status, [action]: 'failed' })),
      )
  }

  function exportData() {
    setExportStatus('exporting')
    saveSettings({ data_scope: dataScope, export_format: exportFormat })

    return axios
      .get(`${API_BASE_URL}/system-export`, {
        params: { scope: dataScope, format: exportFormat },
        responseType: 'blob',
      })
      .then((response) => {
        const disposition = response.headers['content-disposition'] ?? ''
        const filenameMatch = disposition.match(/filename="([^"]+)"/)
        const filename =
          filenameMatch?.[1] ??
          `${dataScope.toLowerCase().replaceAll(' ', '-')}.${exportFormat.toLowerCase()}`
        const url = window.URL.createObjectURL(response.data)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        window.URL.revokeObjectURL(url)
        setExportStatus('done')
      })
      .catch(() => setExportStatus('failed'))
  }

  useEffect(() => {
    let isMounted = true
    let failedHealthChecks = 0

    function checkApiHealth() {
      axios
        .get(`${API_BASE_URL}/health`)
        .then(() => {
          failedHealthChecks = 0
          if (isMounted) markApiConnected()
        })
        .catch(() => {
          failedHealthChecks += 1
          if (isMounted && !apiHasConnectedRef.current && failedHealthChecks >= 3) {
            setApiStatus('offline')
          }
        })
    }

    checkApiHealth()
    const intervalId = window.setInterval(checkApiHealth, 30000)

    axios
      .get(`${API_BASE_URL}/db-health`)
      .then(() => {
        markApiConnected()
        setDbStatus('connected')
      })
      .catch(() => setDbStatus('offline'))

    axios
      .get(`${API_BASE_URL}/model-health`)
      .then(() => {
        markApiConnected()
        setModelStatus('loaded')
      })
      .catch(() => setModelStatus('offline'))

    loadSettings()
    refreshMetadata()

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode])

  function updateThemeMode(nextThemeMode) {
    setThemeMode(nextThemeMode)
    saveTheme(nextThemeMode)
    saveSettings({ theme_mode: nextThemeMode })
  }

  return (
    <>
      <div
        id="overlay"
        className={`overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      ></div>

      <aside
        id="sidebar"
        className={`sidebar prediction-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${
          sidebarOpen ? 'mobile-show' : ''
        }`}
      >
        <div className="logo-area">
          <a href="/admin/dashboard" className="d-inline-flex align-items-center">
            <img
              className="sidebar-brand-logo"
              src="/website_logo.webp"
              alt="Southern Leyte Landslide Prediction"
            />
            <span className="logo-text ms-2 fw-semibold">
              <span>Southern Leyte</span>
              <strong>Landslide Prediction</strong>
            </span>
          </a>
        </div>

        <ul className="nav flex-column">
          <li className="px-4 py-2">
            <small className="nav-text">Main</small>
          </li>
          <li>
            <a className="nav-link" href="/admin/dashboard">
              <i className="ti ti-home"></i>
              <span className="nav-text">Dashboard</span>
            </a>
          </li>
          <li>
            <a className="nav-link" href="/admin/prediction">
              <i className="ti ti-map-2"></i>
              <span className="nav-text">Prediction Map</span>
            </a>
          </li>
          <li>
            <a className="nav-link" href="/admin/reports">
              <i className="ti ti-receipt"></i>
              <span className="nav-text">Reports</span>
            </a>
          </li>
          <li>
            <a className="nav-link" href="/admin/alerts">
              <i className="ti ti-alert-triangle"></i>
              <span className="nav-text">Alerts</span>
            </a>
          </li>

          <li className="px-4 pt-4 pb-2">
            <small className="nav-text">Operations</small>
          </li>
          <li>
            <a className="nav-link" href="/admin/rainfall-scenarios">
              <i className="ti ti-cloud-rain"></i>
              <span className="nav-text">Rainfall Simulation</span>
            </a>
          </li>
          <li>
            <a className="nav-link active" href="/admin/settings">
              <i className="ti ti-settings"></i>
              <span className="nav-text">Settings</span>
            </a>
          </li>
          <li className="px-4 pt-4 pb-2 sidebar-account-label">
            <small className="nav-text">Account</small>
          </li>
          <li className="px-3 pb-3 sidebar-logout-item">
            <a className="nav-link sidebar-logout-link" href="/logout">
              <i className="ti ti-logout"></i>
              <span className="nav-text">Logout</span>
            </a>
          </li>
        </ul>
      </aside>

      <nav
        id="topbar"
        className={`navbar bg-white border-bottom fixed-top topbar px-3 ${
          sidebarCollapsed ? 'full' : ''
        }`}
      >
        <button
          type="button"
          className="d-none d-lg-inline-flex btn btn-light btn-icon btn-sm"
          onClick={() => setSidebarCollapsed((isCollapsed) => !isCollapsed)}
          aria-label="Toggle sidebar"
        >
          <i className="ti ti-menu-2"></i>
        </button>
        <button
          type="button"
          className="btn btn-light btn-icon btn-sm d-lg-none me-2"
          onClick={() => setSidebarOpen((isOpen) => !isOpen)}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <i className="ti ti-menu-2"></i>
        </button>

        <div className="me-auto topbar-heading">
          <div className="small text-secondary">Southern Leyte</div>
          <div className="fw-semibold">Settings</div>
        </div>

        <ul className="list-unstyled d-flex align-items-center mb-0 gap-1">
          <li className="d-none d-sm-block">
            <span className="api-pill">
              <span className={`status-dot status-dot--${apiStatus}`}></span>
              FastAPI {apiStatus}
            </span>
          </li>
          <li>
            <button
              type="button"
              className="btn-icon btn-sm btn-light btn rounded-circle"
              onClick={() =>
                updateThemeMode(themeMode === 'dark' ? 'light' : 'dark')
              }
              aria-label="Toggle theme"
            >
              <i
                className={`ti ${
                  themeMode === 'dark' ? 'ti-sun' : 'ti-moon'
                } fs-5`}
              ></i>
            </button>
          </li>
          <AdminAlertDropdown />
          <AdminProfileMenu />
        </ul>
      </nav>

      <main
        id="content"
        className={`content prediction-content pt-10 ${sidebarCollapsed ? 'full' : ''}`}
      >
        <div className="container-fluid">
          <div className="row">
            <div className="col-12">
              <div className="mb-6">
                <span className="prediction-kicker">System administration</span>
                <h1 className="fs-3 mb-1">Settings</h1>
                <p className="text-secondary mb-0">
                  Manage appearance, exports, health checks, and operational system
                  controls.
                </p>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-xl-3 col-md-6 col-12">
              <StatusCard icon="ti-api" label="FastAPI" value={apiStatus} />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <StatusCard icon="ti-database" label="Database" value={dbStatus} />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <StatusCard icon="ti-brain" label="Model" value={modelStatus} />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <StatusCard icon="ti-palette" label="Theme" value={themeMode} />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Appearance</h4>
                </div>
                <div className="card-body p-4">
                  <div className="settings-segment">
                    <button
                      type="button"
                      className={themeMode === 'light' ? 'active' : ''}
                      onClick={() => updateThemeMode('light')}
                    >
                      <i className="ti ti-sun"></i>
                      Light
                    </button>
                    <button
                      type="button"
                      className={themeMode === 'dark' ? 'active' : ''}
                      onClick={() => updateThemeMode('dark')}
                    >
                      <i className="ti ti-moon"></i>
                      Dark
                    </button>
                  </div>
                  <div className="settings-note mt-4">
                    <strong>Interface mode</strong>
                    <span>
                      Theme preference is saved in the database and restored when the
                      settings page loads.
                    </span>
                  </div>
                  <p className={`predict-status predict-status--${settingsStatus}`}>
                    Settings: {settingsStatus}
                  </p>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Database Export</h4>
                </div>
                <div className="card-body p-4">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="data-scope">
                        Data scope
                      </label>
                      <select
                        id="data-scope"
                        className="form-select"
                        value={dataScope}
                        onChange={(event) => setDataScope(event.target.value)}
                      >
                        <option>Risk Zones</option>
                        <option>Municipality Boundaries</option>
                        <option>Barangay Boundaries</option>
                        <option>Simulation Logs</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label" htmlFor="export-format">
                        Export format
                      </label>
                      <select
                        id="export-format"
                        className="form-select"
                        value={exportFormat}
                        onChange={(event) => setExportFormat(event.target.value)}
                      >
                        <option>GeoJSON</option>
                        <option>CSV</option>
                        <option>SQL Dump</option>
                        <option>PDF Summary</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-action-row mt-4">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={exportData}
                      disabled={exportStatus === 'exporting'}
                    >
                      <i className="ti ti-database-export me-1"></i>
                      {exportStatus === 'exporting' ? 'Exporting...' : `Export ${dataScope}`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={refreshMetadata}
                      disabled={metadataStatus === 'loading'}
                    >
                      <i className="ti ti-refresh me-1"></i>
                      {metadataStatus === 'loading' ? 'Refreshing...' : 'Refresh Metadata'}
                    </button>
                  </div>
                  <p className="predict-status">
                    Selected export: {dataScope} as {exportFormat} / {exportStatus}
                  </p>
                  <div className="settings-default-grid mt-4">
                    <DefaultItem
                      label="Risk zones"
                      value={metadata?.risk_zones ?? '...'}
                    />
                    <DefaultItem
                      label="Simulation logs"
                      value={metadata?.simulation_logs ?? '...'}
                    />
                    <DefaultItem
                      label="Barangays"
                      value={metadata?.barangay_boundaries ?? '...'}
                    />
                    <DefaultItem
                      label="Metadata"
                      value={metadataStatus}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-6">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">System Controls</h4>
                </div>
                <div className="card-body p-4">
                  <div className="settings-control-list">
                    <ControlItem
                      action="reload-risk-zones"
                      icon="ti-map-search"
                      title="Reload Risk Zones"
                      text="Request the latest mapped prediction records from the API."
                      status={controlStatus['reload-risk-zones']}
                      onRun={() => runControl('reload-risk-zones')}
                    />
                    <ControlItem
                      action="check-model-health"
                      icon="ti-brain"
                      title="Check Model Health"
                      text="Validate model availability before live prediction runs."
                      status={controlStatus['check-model-health']}
                      onRun={() => runControl('check-model-health')}
                    />
                    <ControlItem
                      action="backup-configuration"
                      icon="ti-shield-check"
                      title="Backup Configuration"
                      text="Prepare current system configuration for administrative backup."
                      status={controlStatus['backup-configuration']}
                      onRun={() => runControl('backup-configuration')}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-6">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Operational Defaults</h4>
                </div>
                <div className="card-body p-4">
                  <div className="settings-default-grid">
                    <label className="settings-field">
                      <span>Default municipality</span>
                      <input
                        className="form-control"
                        value={defaultMunicipality}
                        onChange={(event) => setDefaultMunicipality(event.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Default rainfall</span>
                      <input
                        className="form-control"
                        type="number"
                        min="0"
                        max="300"
                        value={defaultRainfall}
                        onChange={(event) => setDefaultRainfall(event.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Default duration</span>
                      <input
                        className="form-control"
                        type="number"
                        min="0"
                        max="168"
                        value={defaultDuration}
                        onChange={(event) => setDefaultDuration(event.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Map interaction</span>
                      <select
                        className="form-select"
                        value={mapInteraction}
                        onChange={(event) => setMapInteraction(event.target.value)}
                      >
                        <option>Locked by default</option>
                        <option>Interactive by default</option>
                      </select>
                    </label>
                  </div>
                  <div className="settings-action-row mt-4">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => saveSettings()}
                      disabled={settingsStatus === 'saving'}
                    >
                      <i className="ti ti-device-floppy me-1"></i>
                      {settingsStatus === 'saving' ? 'Saving...' : 'Save Defaults'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row">
            <div className="col-12">
              <footer className="app-footer mt-6 mb-0">
                <div>
                  <p className="app-footer-title">
                    Southern Leyte Landslide Prediction System
                  </p>
                  <span className="app-footer-subtitle">
                    Geospatial risk intelligence and rainfall scenario monitoring
                  </span>
                </div>
                <div className="app-footer-meta">
                  <span>Settings</span>
                  <span>2026</span>
                </div>
              </footer>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}

function StatusCard({ icon, label, value }) {
  return (
    <div className="card p-4 border rounded-2 h-100 bg-primary bg-opacity-10 border-primary border-opacity-25">
      <div className="d-flex gap-3">
        <div className="icon-shape icon-md bg-primary text-white rounded-2">
          <i className={`ti ${icon} fs-4`}></i>
        </div>
        <div>
          <h2 className="mb-3 fs-6">{label}</h2>
          <h3 className="fw-bold mb-0 text-capitalize">{value}</h3>
          <p className="text-primary mb-0 small">System status</p>
        </div>
      </div>
    </div>
  )
}

function ControlItem({ icon, title, text, status = 'idle', onRun }) {
  return (
    <div className="control-item">
      <div className="icon-shape icon-sm bg-primary bg-opacity-10 text-primary rounded-2">
        <i className={`ti ${icon}`}></i>
      </div>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-light"
        onClick={onRun}
        disabled={status === 'running'}
      >
        {status === 'running' ? 'Running...' : status === 'done' ? 'Done' : 'Run'}
      </button>
    </div>
  )
}

function DefaultItem({ label, value }) {
  return (
    <div className="preview-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default SettingsPage
