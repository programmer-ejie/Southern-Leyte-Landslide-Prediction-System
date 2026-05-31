import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'

const API_BASE_URL = 'http://127.0.0.1:8000'

const numberFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 1,
})

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
})

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

function formatNumber(value) {
  return numberFormatter.format(value ?? 0)
}

function formatPeso(value) {
  return currencyFormatter.format(value ?? 0)
}

function buildLossSummary(riskZones) {
  return (riskZones?.features ?? []).reduce(
    (summary, feature) => {
      const loss = feature.properties.loss_estimate

      if (!loss) {
        return summary
      }

      return {
        area: summary.area + loss.estimated_area_sq_km,
        people: summary.people + loss.estimated_affected_people,
        economicLoss: summary.economicLoss + loss.estimated_economic_loss_php,
        casualties: summary.casualties + loss.estimated_possible_casualties,
      }
    },
    { area: 0, people: 0, economicLoss: 0, casualties: 0 },
  )
}

function buildRiskDistribution(riskZones) {
  const counts = {}

  riskZones?.features?.forEach((feature) => {
    const label =
      riskLabelByLevel[feature.properties.risk_level] ?? feature.properties.risk_level
    counts[label] = (counts[label] ?? 0) + 1
  })

  return Object.entries(counts)
    .map(([label, count]) => ({
      label,
      count,
      color: riskColorByLabel[label] ?? '#3673fc',
    }))
    .sort((a, b) => b.count - a.count)
}

function getDamageHotspot(riskZones) {
  return [...(riskZones?.features ?? [])].sort((featureA, featureB) => {
    const lossA = featureA.properties.loss_estimate?.estimated_economic_loss_php ?? 0
    const lossB = featureB.properties.loss_estimate?.estimated_economic_loss_php ?? 0

    return lossB - lossA
  })[0]
}

function RainfallScenariosPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [riskStatus, setRiskStatus] = useState('loading')
  const [simulationStatus, setSimulationStatus] = useState('idle')
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem('sl-lps-theme') ?? 'light',
  )
  const [riskZones, setRiskZones] = useState(null)
  const [rainfallRate, setRainfallRate] = useState(120)
  const [durationHours, setDurationHours] = useState(6)
  const [saturationFactor, setSaturationFactor] = useState(1)
  const [simulationLogs, setSimulationLogs] = useState([])

  const lossSummary = useMemo(() => buildLossSummary(riskZones), [riskZones])
  const riskDistribution = useMemo(
    () => buildRiskDistribution(riskZones),
    [riskZones],
  )
  const damageHotspot = useMemo(() => getDamageHotspot(riskZones), [riskZones])
  const maxDistributionCount = Math.max(
    1,
    ...riskDistribution.map((item) => item.count),
  )
  const highRiskZones =
    riskZones?.features?.filter((feature) =>
      ['75%', '100%', 'High'].includes(feature.properties.risk_level),
    ).length ?? 0
  const intensityIndex = Math.min(
    100,
    Math.round(
      (Number(rainfallRate) / 300) * 55 +
        (Number(durationHours) / 168) * 25 +
        (Number(saturationFactor) / 2) * 20,
    ),
  )

  function loadRiskZones() {
    setRiskStatus('loading')

    return axios
      .get(`${API_BASE_URL}/risk-zones`)
      .then((response) => {
        setRiskZones(response.data)
        setRiskStatus('loaded')
        return response.data
      })
      .catch(() => {
        setRiskStatus('unavailable')
        return null
      })
  }

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/health`)
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('offline'))
  }, [])

  useEffect(() => {
    loadRiskZones()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    localStorage.setItem('sl-lps-theme', themeMode)
  }, [themeMode])

  function runRainfallSimulation() {
    setSimulationStatus('running')

    axios
      .post(`${API_BASE_URL}/simulate-rainfall`, {
        rainfall_mm_per_hr: Number(rainfallRate),
        duration_hours: Number(durationHours),
        saturation_factor: Number(saturationFactor),
      })
      .then(() => loadRiskZones())
      .then((updatedRiskZones) => {
        const summary = buildLossSummary(updatedRiskZones)
        const hotspot = getDamageHotspot(updatedRiskZones)

        setSimulationLogs((logs) => [
          {
            id: `${Date.now()}`,
            timestamp: new Date().toLocaleString('en-PH'),
            rainfallRate: Number(rainfallRate),
            durationHours: Number(durationHours),
            saturationFactor: Number(saturationFactor),
            affectedPeople: summary.people,
            economicLoss: summary.economicLoss,
            hotspot: hotspot?.properties?.name ?? 'No hotspot',
            riskLevel:
              riskLabelByLevel[hotspot?.properties?.risk_level] ??
              hotspot?.properties?.risk_level ??
              'Unavailable',
          },
          ...logs,
        ])
        setSimulationStatus('saved')
      })
      .catch(() => setSimulationStatus('failed'))
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
            <a className="nav-link active" href="/admin/rainfall-scenarios">
              <i className="ti ti-cloud-rain"></i>
              <span className="nav-text">Rainfall Scenarios</span>
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
          <div className="fw-semibold">Rainfall Scenarios</div>
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
                <span className="prediction-kicker">Simulation and impact logs</span>
                <h1 className="fs-3 mb-1">Rainfall Scenarios</h1>
                <p className="text-secondary mb-0">
                  Run rainfall scenarios, review generated risk values, and identify
                  where estimated damage is highest.
                </p>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-xl-3 col-md-6 col-12">
              <ScenarioMetric
                icon="ti-cloud-rain"
                label="Rainfall Rate"
                value={`${formatNumber(rainfallRate)} mm/hr`}
                note="Current scenario"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <ScenarioMetric
                icon="ti-clock-hour-6"
                label="Duration"
                value={`${formatNumber(durationHours)} hr`}
                note="Simulation window"
                tone="info"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <ScenarioMetric
                icon="ti-droplet-filled"
                label="Saturation"
                value={formatNumber(saturationFactor)}
                note="Soil factor"
                tone="warning"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <ScenarioMetric
                icon="ti-alert-triangle"
                label="High Risk Zones"
                value={formatNumber(highRiskZones)}
                note={riskStatus}
                tone="danger"
              />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-4">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Scenario Builder</h4>
                </div>
                <div className="card-body p-4">
                  <label className="form-label" htmlFor="scenario-rainfall">
                    Rainfall mm/hr
                  </label>
                  <input
                    id="scenario-rainfall"
                    className="form-control mb-3"
                    type="number"
                    min="0"
                    max="300"
                    value={rainfallRate}
                    onChange={(event) => setRainfallRate(event.target.value)}
                  />

                  <label className="form-label" htmlFor="scenario-duration">
                    Duration hours
                  </label>
                  <input
                    id="scenario-duration"
                    className="form-control mb-3"
                    type="number"
                    min="0"
                    max="168"
                    value={durationHours}
                    onChange={(event) => setDurationHours(event.target.value)}
                  />

                  <label className="form-label" htmlFor="scenario-saturation">
                    Saturation factor
                  </label>
                  <input
                    id="scenario-saturation"
                    className="form-control mb-4"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={saturationFactor}
                    onChange={(event) => setSaturationFactor(event.target.value)}
                  />

                  <button
                    type="button"
                    className="btn btn-primary w-100"
                    onClick={runRainfallSimulation}
                    disabled={simulationStatus === 'running'}
                  >
                    <i className="ti ti-player-play me-1"></i>
                    {simulationStatus === 'running' ? 'Simulating...' : 'Run Scenario'}
                  </button>
                  <p className={`predict-status predict-status--${simulationStatus}`}>
                    Simulation: {simulationStatus}
                  </p>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-4">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Scenario Intensity</h4>
                </div>
                <div className="card-body p-4">
                  <div className="probability-gauge">
                    <div
                      className="probability-gauge-fill"
                      style={{ transform: `rotate(${(intensityIndex / 100) * 180}deg)` }}
                    ></div>
                    <div className="probability-gauge-cover">
                      <strong>{intensityIndex}</strong>
                      <span>Intensity index</span>
                    </div>
                  </div>
                  <div className="dashboard-figure-grid">
                    <div>
                      <span>Affected people</span>
                      <strong>{formatNumber(lossSummary.people)}</strong>
                    </div>
                    <div>
                      <span>Economic loss</span>
                      <strong>{formatPeso(lossSummary.economicLoss)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-4">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Most Damage Expected</h4>
                </div>
                <div className="card-body p-4">
                  {damageHotspot ? (
                    <div className="damage-hotspot">
                      <span className="severity-pill severity-pill--High">
                        {riskLabelByLevel[damageHotspot.properties.risk_level] ??
                          damageHotspot.properties.risk_level}
                      </span>
                      <h3>{damageHotspot.properties.name}</h3>
                      <div className="alert-detail-grid">
                        <PreviewDatum
                          label="Economic loss"
                          value={formatPeso(
                            damageHotspot.properties.loss_estimate
                              ?.estimated_economic_loss_php,
                          )}
                        />
                        <PreviewDatum
                          label="Affected"
                          value={formatNumber(
                            damageHotspot.properties.loss_estimate
                              ?.estimated_affected_people,
                          )}
                        />
                      </div>
                      <div className="report-recommendation">
                        <strong>Recommendation</strong>
                        <span>
                          {
                            damageHotspot.properties.loss_estimate
                              ?.recommendation
                          }
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-secondary mb-0">No damage hotspot available.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Risk Output</h4>
                </div>
                <div className="card-body p-4">
                  <div className="risk-bars">
                    {riskDistribution.map((item) => (
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
                              width: `${(item.count / Math.max(1, riskZones?.features?.length ?? 0)) * 100}%`,
                              background: item.color,
                            }}
                          ></div>
                        </div>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                    {riskDistribution.length === 0 && (
                      <p className="text-secondary mb-0">No risk output available.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Simulation Logs</h4>
                </div>
                <div className="table-responsive">
                  <table className="table reports-table mb-0">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Scenario</th>
                        <th>Damage hotspot</th>
                        <th>Economic loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulationLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{log.timestamp}</td>
                          <td>
                            {log.rainfallRate}mm / {log.durationHours}h / sat{' '}
                            {log.saturationFactor}
                          </td>
                          <td>
                            {log.hotspot}
                            <span className="d-block text-secondary small">
                              {log.riskLevel}
                            </span>
                          </td>
                          <td>{formatPeso(log.economicLoss)}</td>
                        </tr>
                      ))}
                      {simulationLogs.length === 0 && (
                        <tr>
                          <td colSpan="4" className="text-secondary text-center">
                            No simulations run in this session yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
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
                  <span>Rainfall Scenarios</span>
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

function ScenarioMetric({ icon, label, value, note, tone = 'primary' }) {
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

export default RainfallScenariosPage
