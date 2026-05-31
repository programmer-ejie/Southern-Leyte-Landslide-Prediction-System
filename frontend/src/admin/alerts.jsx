import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'

const API_BASE_URL = 'http://127.0.0.1:8000'
const ALERTS_PER_PAGE = 6

const riskLabelByLevel = {
  '15%': 'Low',
  '30%': 'Slightly Low',
  '50%': 'Moderate',
  '75%': 'High',
  '100%': 'Very High',
  Low: 'Low',
  Medium: 'Moderate',
  High: 'High',
}

const riskColorByLabel = {
  Low: '#22c55e',
  'Slightly Low': '#84cc16',
  Moderate: '#facc15',
  High: '#f97316',
  'Very High': '#dc2626',
}

const numberFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 1,
})

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 0,
})

function formatNumber(value) {
  return numberFormatter.format(value ?? 0)
}

function formatPeso(value) {
  return `PHP ${currencyFormatter.format(value ?? 0)}`
}

function getSeverity(feature) {
  const probability = feature.properties.probability ?? 0
  const label =
    riskLabelByLevel[feature.properties.risk_level] ?? feature.properties.risk_level

  if (label === 'Very High' || probability >= 0.85) {
    return 'Critical'
  }

  if (label === 'High' || probability >= 0.7) {
    return 'High'
  }

  if (label === 'Moderate' || probability >= 0.45) {
    return 'Monitoring'
  }

  return 'Watch'
}

function getPriorityScore(feature) {
  const probability = feature.properties.probability ?? 0
  const affectedPeople =
    feature.properties.loss_estimate?.estimated_affected_people ?? 0
  const exposureScore = Math.min(affectedPeople / 150000, 1)

  return Math.round((probability * 0.72 + exposureScore * 0.28) * 100)
}

function buildAlerts(riskZones) {
  return [...(riskZones?.features ?? [])]
    .map((feature) => ({
      id: feature.properties.id,
      name: feature.properties.name,
      riskLevel:
        riskLabelByLevel[feature.properties.risk_level] ??
        feature.properties.risk_level,
      probability: feature.properties.probability ?? 0,
      severity: getSeverity(feature),
      priority: getPriorityScore(feature),
      loss: feature.properties.loss_estimate,
    }))
    .sort((alertA, alertB) => alertB.priority - alertA.priority)
}

function buildSeverityDistribution(alerts) {
  const counts = {}

  alerts.forEach((alert) => {
    counts[alert.severity] = (counts[alert.severity] ?? 0) + 1
  })

  const colors = {
    Critical: '#dc2626',
    High: '#f97316',
    Monitoring: '#facc15',
    Watch: '#22c55e',
  }

  return Object.entries(counts).map(([label, count]) => ({
    label,
    count,
    color: colors[label] ?? '#3673fc',
  }))
}

function buildDonutGradient(distribution) {
  const total = distribution.reduce((sum, item) => sum + item.count, 0)
  let start = 0

  if (!total) {
    return '#eef2ff'
  }

  return distribution
    .map((item) => {
      const end = start + (item.count / total) * 360
      const segment = `${item.color} ${start}deg ${end}deg`
      start = end
      return segment
    })
    .join(', ')
}

function AlertsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [riskStatus, setRiskStatus] = useState('loading')
  const [riskZones, setRiskZones] = useState(null)
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem('sl-lps-theme') ?? 'light',
  )
  const [selectedAlertId, setSelectedAlertId] = useState(null)
  const [alertPage, setAlertPage] = useState(1)

  const alerts = useMemo(() => buildAlerts(riskZones), [riskZones])
  const totalAlertPages = Math.max(1, Math.ceil(alerts.length / ALERTS_PER_PAGE))
  const pagedAlerts = alerts.slice(
    (alertPage - 1) * ALERTS_PER_PAGE,
    alertPage * ALERTS_PER_PAGE,
  )
  const selectedAlert =
    alerts.find((alert) => alert.id === selectedAlertId) ?? alerts[0] ?? null
  const severityDistribution = useMemo(
    () => buildSeverityDistribution(alerts),
    [alerts],
  )
  const donutGradient = buildDonutGradient(severityDistribution)
  const activeAlerts = alerts.filter((alert) => alert.priority >= 45).length
  const criticalAlerts = alerts.filter((alert) => alert.severity === 'Critical').length
  const affectedPeople = alerts.reduce(
    (sum, alert) => sum + (alert.loss?.estimated_affected_people ?? 0),
    0,
  )
  const evacuationWatch = alerts.filter((alert) => alert.priority >= 70).length
  const maxSeverityCount = Math.max(
    1,
    ...severityDistribution.map((item) => item.count),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    localStorage.setItem('sl-lps-theme', themeMode)
  }, [themeMode])

  useEffect(() => {
    setAlertPage(1)
  }, [alerts.length])

  useEffect(() => {
    if (alertPage > totalAlertPages) {
      setAlertPage(totalAlertPages)
    }
  }, [alertPage, totalAlertPages])

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/health`)
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('offline'))
  }, [])

  useEffect(() => {
    setRiskStatus('loading')
    axios
      .get(`${API_BASE_URL}/risk-zones`)
      .then((response) => {
        setRiskZones(response.data)
        setRiskStatus('loaded')
      })
      .catch(() => setRiskStatus('unavailable'))
  }, [])

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
            <a className="nav-link active" href="/admin/alerts">
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
            <a className="nav-link" href="/admin/settings">
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
          <div className="fw-semibold">Alerts</div>
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
          <AdminAlertDropdown riskZones={riskZones} />
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
                <span className="prediction-kicker">Response priority center</span>
                <h1 className="fs-3 mb-1">Alerts</h1>
                <p className="text-secondary mb-0">
                  Track priority zones, estimated exposure, and recommended response
                  actions from the latest prediction data.
                </p>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-xl-3 col-md-6 col-12">
              <AlertMetric
                icon="ti-bell-ringing"
                label="Active Alerts"
                value={formatNumber(activeAlerts)}
                note={riskStatus}
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <AlertMetric
                icon="ti-alert-octagon"
                label="Critical Zones"
                value={formatNumber(criticalAlerts)}
                note="Immediate review"
                tone="danger"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <AlertMetric
                icon="ti-users"
                label="Affected People"
                value={formatNumber(affectedPeople)}
                note="Estimated exposure"
                tone="success"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <AlertMetric
                icon="ti-route"
                label="Evacuation Watch"
                value={formatNumber(evacuationWatch)}
                note="Priority score 70+"
                tone="warning"
              />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-7">
              <div className="card h-100" id="alerts-feed">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Alert Feed</h4>
                </div>
                <div className="card-body p-4">
                  <div className="alert-feed">
                    {pagedAlerts.map((alert) => (
                      <button
                        type="button"
                        className={`alert-feed-item ${
                          selectedAlert?.id === alert.id ? 'alert-feed-item--active' : ''
                        }`}
                        key={alert.id}
                        onClick={() => setSelectedAlertId(alert.id)}
                      >
                        <span className={`severity-pill severity-pill--${alert.severity}`}>
                          {alert.severity}
                        </span>
                        <div>
                          <strong>{alert.name}</strong>
                          <span>
                            {alert.riskLevel} risk ·{' '}
                            {Math.round(alert.probability * 100)}% probability
                          </span>
                        </div>
                        <span className="priority-score">{alert.priority}</span>
                      </button>
                    ))}
                    {alerts.length === 0 && (
                      <p className="text-secondary mb-0">No alerts available.</p>
                    )}
                  </div>
                  {alerts.length > ALERTS_PER_PAGE && (
                    <div className="alert-pagination">
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        disabled={alertPage === 1}
                        onClick={() => setAlertPage((page) => Math.max(1, page - 1))}
                      >
                        <i className="ti ti-chevron-left"></i>
                        Previous
                      </button>
                      <span>
                        Page {alertPage} of {totalAlertPages}
                      </span>
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        disabled={alertPage === totalAlertPages}
                        onClick={() =>
                          setAlertPage((page) => Math.min(totalAlertPages, page + 1))
                        }
                      >
                        Next
                        <i className="ti ti-chevron-right"></i>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Alert Detail</h4>
                </div>
                <div className="card-body p-4">
                  {selectedAlert ? (
                    <div className="alert-detail">
                      <span
                        className={`severity-pill severity-pill--${selectedAlert.severity}`}
                      >
                        {selectedAlert.severity}
                      </span>
                      <h3>{selectedAlert.name}</h3>
                      <div className="alert-detail-grid">
                        <PreviewDatum
                          label="Risk"
                          value={selectedAlert.riskLevel}
                        />
                        <PreviewDatum
                          label="Probability"
                          value={`${Math.round(selectedAlert.probability * 100)}%`}
                        />
                        <PreviewDatum
                          label="Affected"
                          value={formatNumber(
                            selectedAlert.loss?.estimated_affected_people,
                          )}
                        />
                        <PreviewDatum
                          label="Economic loss"
                          value={formatPeso(
                            selectedAlert.loss?.estimated_economic_loss_php,
                          )}
                        />
                      </div>
                      <div className="report-recommendation">
                        <strong>Recommended action</strong>
                        <span>{selectedAlert.loss?.recommendation}</span>
                      </div>
                      <div className="advisory-template">
                        <strong>Advisory message</strong>
                        <span>
                          {selectedAlert.name} is under {selectedAlert.riskLevel} risk
                          monitoring. Residents in exposed areas should follow local
                          advisories and avoid steep or saturated slopes.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-secondary mb-0">Select an alert to review.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Severity Visualization</h4>
                </div>
                <div className="card-body p-4">
                  <div className="risk-figure-layout">
                    <div
                      className="risk-donut"
                      style={{ background: `conic-gradient(${donutGradient})` }}
                    >
                      <div className="risk-donut-center">
                        <strong>{formatNumber(alerts.length)}</strong>
                        <span>Alerts</span>
                      </div>
                    </div>
                    <div className="risk-bars">
                      {severityDistribution.map((item) => (
                        <div className="risk-bar-row" key={item.label}>
                          <span>
                            <i
                              className="risk-dot"
                              style={{ backgroundColor: item.color }}
                            ></i>
                            {item.label}
                          </span>
                          <div className="risk-bar-track">
                            <div
                              className="risk-bar-fill"
                              style={{
                                width: `${(item.count / maxSeverityCount) * 100}%`,
                                background: item.color,
                              }}
                            ></div>
                          </div>
                          <strong>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Action Center</h4>
                </div>
                <div className="card-body p-4">
                  <div className="action-center">
                    <button type="button" className="btn btn-primary">
                      <i className="ti ti-eye-check me-1"></i>
                      Mark Monitoring
                    </button>
                    <button type="button" className="btn btn-primary">
                      <i className="ti ti-circle-check me-1"></i>
                      Mark Resolved
                    </button>
                    <button type="button" className="btn btn-primary">
                      <i className="ti ti-printer me-1"></i>
                      Print Advisory
                    </button>
                    <button type="button" className="btn btn-primary">
                      <i className="ti ti-file-export me-1"></i>
                      Export Alert List
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
                  <span>Alerts</span>
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

function AlertMetric({ icon, label, value, note, tone = 'primary' }) {
  return (
    <div
      className={`card p-4 border rounded-2 h-100 bg-${tone} bg-opacity-10 border-${tone} border-opacity-25`}
    >
      <div className="d-flex gap-3">
        <div className={`icon-shape icon-md bg-${tone} text-white rounded-2`}>
          <i className={`ti ${icon} fs-4`}></i>
        </div>
        <div className="min-w-0">
          <h2 className="mb-3 fs-6">{label}</h2>
          <h3 className="fw-bold mb-0 dashboard-card-value">{value}</h3>
          <p className={`mb-0 small text-${tone} text-capitalize`}>{note}</p>
        </div>
      </div>
    </div>
  )
}

function PreviewDatum({ label, value }) {
  return (
    <div className="preview-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default AlertsPage
