import { useEffect, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'

const API_BASE_URL = 'http://127.0.0.1:8000'

function SettingsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [dbStatus, setDbStatus] = useState('checking')
  const [modelStatus, setModelStatus] = useState('checking')
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem('sl-lps-theme') ?? 'light',
  )
  const [exportFormat, setExportFormat] = useState('GeoJSON')
  const [dataScope, setDataScope] = useState('Risk Zones')

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/health`)
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('offline'))

    axios
      .get(`${API_BASE_URL}/db-health`)
      .then(() => setDbStatus('connected'))
      .catch(() => setDbStatus('offline'))

    axios
      .get(`${API_BASE_URL}/model-health`)
      .then(() => setModelStatus('loaded'))
      .catch(() => setModelStatus('offline'))
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    localStorage.setItem('sl-lps-theme', themeMode)
  }, [themeMode])

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
              <span className="nav-text">Rainfall Scenarios</span>
            </a>
          </li>
          <li>
            <a className="nav-link active" href="/admin/settings">
              <i className="ti ti-settings"></i>
              <span className="nav-text">Settings</span>
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
                setThemeMode((currentMode) =>
                  currentMode === 'dark' ? 'light' : 'dark',
                )
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
          <li className="ms-3">
            <span className="avatar avatar-sm avatar-primary rounded-circle overflow-hidden">
              <span className="avatar-initials rounded-circle">EJ</span>
            </span>
          </li>
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
                      onClick={() => setThemeMode('light')}
                    >
                      <i className="ti ti-sun"></i>
                      Light
                    </button>
                    <button
                      type="button"
                      className={themeMode === 'dark' ? 'active' : ''}
                      onClick={() => setThemeMode('dark')}
                    >
                      <i className="ti ti-moon"></i>
                      Dark
                    </button>
                  </div>
                  <div className="settings-note mt-4">
                    <strong>Interface mode</strong>
                    <span>
                      The toggle is prepared for system-wide theme switching. Current
                      dashboard styling remains optimized for light mode.
                    </span>
                  </div>
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
                    <button type="button" className="btn btn-primary">
                      <i className="ti ti-database-export me-1"></i>
                      Export {dataScope}
                    </button>
                    <button type="button" className="btn btn-outline-primary">
                      <i className="ti ti-refresh me-1"></i>
                      Refresh Metadata
                    </button>
                  </div>
                  <p className="predict-status">
                    Selected export: {dataScope} as {exportFormat}
                  </p>
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
                      icon="ti-map-search"
                      title="Reload Risk Zones"
                      text="Request the latest mapped prediction records from the API."
                    />
                    <ControlItem
                      icon="ti-brain"
                      title="Check Model Health"
                      text="Validate model availability before live prediction runs."
                    />
                    <ControlItem
                      icon="ti-shield-check"
                      title="Backup Configuration"
                      text="Prepare current system configuration for administrative backup."
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
                    <DefaultItem label="Default municipality" value="Bontoc" />
                    <DefaultItem label="Default rainfall" value="120 mm/hr" />
                    <DefaultItem label="Default duration" value="6 hours" />
                    <DefaultItem label="Map interaction" value="Locked by default" />
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

function ControlItem({ icon, title, text }) {
  return (
    <div className="control-item">
      <div className="icon-shape icon-sm bg-primary bg-opacity-10 text-primary rounded-2">
        <i className={`ti ${icon}`}></i>
      </div>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <button type="button" className="btn btn-sm btn-light">
        Run
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
