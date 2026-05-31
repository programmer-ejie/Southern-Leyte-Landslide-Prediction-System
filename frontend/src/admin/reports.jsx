import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'

const API_BASE_URL = 'http://127.0.0.1:8000'

const MUNICIPALITIES = [
  'Anahawan',
  'Bontoc',
  'Hinunangan',
  'Hinundayan',
  'Libagon',
  'Liloan',
  'Limasawa',
  'Maasin City',
  'Macrohon',
  'Malitbog',
  'Padre Burgos',
  'Pintuyan',
  'Saint Bernard',
  'San Francisco',
  'San Juan',
  'San Ricardo',
  'Silago',
  'Sogod',
  'Tomas Oppus',
]

const REPORT_TYPES = [
  'Risk Summary',
  'Loss Estimate',
  'Rainfall Simulation',
  'Barangay Exposure',
]

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
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
})

function formatNumber(value) {
  return numberFormatter.format(value ?? 0)
}

function formatPeso(value) {
  return currencyFormatter.format(value ?? 0)
}

function buildLossSummary(riskZones) {
  if (!riskZones?.features?.length) {
    return { area: 0, people: 0, economicLoss: 0, casualties: 0 }
  }

  return riskZones.features.reduce(
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

function getHighestRiskZone(riskZones) {
  return [...(riskZones?.features ?? [])].sort(
    (featureA, featureB) =>
      (featureB.properties.probability ?? 0) -
      (featureA.properties.probability ?? 0),
  )[0]
}

function ReportsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [riskStatus, setRiskStatus] = useState('loading')
  const [riskZones, setRiskZones] = useState(null)
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem('sl-lps-theme') ?? 'light',
  )
  const [selectedMunicipality, setSelectedMunicipality] = useState('Bontoc')
  const [selectedReportType, setSelectedReportType] = useState('Risk Summary')
  const [selectedFormat, setSelectedFormat] = useState('PDF')

  const lossSummary = useMemo(() => buildLossSummary(riskZones), [riskZones])
  const riskDistribution = useMemo(
    () => buildRiskDistribution(riskZones),
    [riskZones],
  )
  const highestRiskZone = useMemo(() => getHighestRiskZone(riskZones), [riskZones])
  const donutGradient = buildDonutGradient(riskDistribution)
  const mappedZones = riskZones?.features?.length ?? 0
  const highRiskZones =
    riskZones?.features?.filter((feature) =>
      ['75%', '100%', 'High'].includes(feature.properties.risk_level),
    ).length ?? 0
  const latestProbability = highestRiskZone?.properties?.probability ?? 0

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    localStorage.setItem('sl-lps-theme', themeMode)
  }, [themeMode])

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

  const reportRows = [
    {
      name: `${selectedMunicipality} ${selectedReportType}`,
      area: selectedMunicipality,
      type: selectedReportType,
      status: riskStatus,
    },
    {
      name: 'Province Risk Summary',
      area: 'Southern Leyte',
      type: 'Risk Summary',
      status: riskStatus,
    },
    {
      name: 'Estimated Loss Register',
      area: 'Southern Leyte',
      type: 'Loss Estimate',
      status: riskStatus,
    },
  ]

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
            <a className="nav-link active" href="/admin/reports">
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
          <div className="fw-semibold">Reports</div>
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
                <span className="prediction-kicker">Audit and export center</span>
                <h1 className="fs-3 mb-1">Reports</h1>
                <p className="text-secondary mb-0">
                  Build, preview, and export risk summaries from the latest prediction
                  data.
                </p>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-xl-3 col-md-6 col-12">
              <ReportMetric
                icon="ti-file-analytics"
                label="Report Sources"
                value={formatNumber(mappedZones)}
                note="Mapped prediction zones"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <ReportMetric
                icon="ti-alert-triangle"
                label="High Risk Zones"
                value={formatNumber(highRiskZones)}
                note="Priority records"
                tone="danger"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <ReportMetric
                icon="ti-users"
                label="Affected People"
                value={formatNumber(lossSummary.people)}
                note="Planning estimate"
                tone="success"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <ReportMetric
                icon="ti-cash-banknote"
                label="Economic Exposure"
                value={formatPeso(lossSummary.economicLoss)}
                note="Estimated loss"
                tone="info"
              />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Report Builder</h4>
                </div>
                <div className="card-body p-4">
                  <label className="form-label" htmlFor="report-municipality">
                    Municipality
                  </label>
                  <select
                    id="report-municipality"
                    className="form-select mb-3"
                    value={selectedMunicipality}
                    onChange={(event) => setSelectedMunicipality(event.target.value)}
                  >
                    {MUNICIPALITIES.map((municipality) => (
                      <option key={municipality} value={municipality}>
                        {municipality}
                      </option>
                    ))}
                  </select>

                  <label className="form-label" htmlFor="report-type">
                    Report type
                  </label>
                  <select
                    id="report-type"
                    className="form-select mb-3"
                    value={selectedReportType}
                    onChange={(event) => setSelectedReportType(event.target.value)}
                  >
                    {REPORT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>

                  <label className="form-label" htmlFor="report-format">
                    Export format
                  </label>
                  <select
                    id="report-format"
                    className="form-select mb-4"
                    value={selectedFormat}
                    onChange={(event) => setSelectedFormat(event.target.value)}
                  >
                    <option>PDF</option>
                    <option>CSV</option>
                    <option>Print</option>
                  </select>

                  <div className="d-flex gap-2 flex-wrap">
                    <button type="button" className="btn btn-primary">
                      <i className="ti ti-file-export me-1"></i>
                      Generate {selectedFormat}
                    </button>
                    <button type="button" className="btn btn-outline-primary">
                      <i className="ti ti-printer me-1"></i>
                      Print
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Report Preview</h4>
                </div>
                <div className="card-body p-4">
                  <div className="report-preview">
                    <div>
                      <span className="prediction-kicker">Preview document</span>
                      <h3>{selectedMunicipality} {selectedReportType}</h3>
                      <p>
                        Latest model output summary for selected administrative area.
                      </p>
                    </div>
                    <div className="report-preview-grid">
                      <PreviewItem label="Risk zones" value={formatNumber(mappedZones)} />
                      <PreviewItem
                        label="Highest probability"
                        value={`${Math.round(latestProbability * 100)}%`}
                      />
                      <PreviewItem
                        label="Affected people"
                        value={formatNumber(lossSummary.people)}
                      />
                      <PreviewItem
                        label="Economic loss"
                        value={formatPeso(lossSummary.economicLoss)}
                      />
                    </div>
                    <div className="report-recommendation">
                      <strong>Recommendation</strong>
                      <span>
                        Prioritize high-probability zones, validate exposed barangays,
                        and prepare printable summaries for municipal response teams.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Risk Summary Figure</h4>
                </div>
                <div className="card-body p-4">
                  <div className="risk-figure-layout risk-figure-layout--compact">
                    <div
                      className="risk-donut"
                      style={{ background: `conic-gradient(${buildDonutGradient(riskDistribution)})` }}
                    >
                      <div className="risk-donut-center">
                        <strong>{formatNumber(mappedZones)}</strong>
                        <span>Zones</span>
                      </div>
                    </div>
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
                                width: `${(item.count / Math.max(1, mappedZones)) * 100}%`,
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

            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Generated Reports</h4>
                </div>
                <div className="table-responsive">
                  <table className="table reports-table mb-0">
                    <thead>
                      <tr>
                        <th>Report</th>
                        <th>Area</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th className="text-end">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((row) => (
                        <tr key={`${row.name}-${row.type}`}>
                          <td>{row.name}</td>
                          <td>{row.area}</td>
                          <td>{row.type}</td>
                          <td>
                            <span className="badge bg-primary-subtle text-primary text-capitalize">
                              {row.status}
                            </span>
                          </td>
                          <td className="text-end">
                            <button type="button" className="btn btn-sm btn-light">
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
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
                  <span>Reports</span>
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

function ReportMetric({ icon, label, value, note, tone = 'primary' }) {
  return (
    <div className={`card p-4 border rounded-2 h-100 bg-${tone} bg-opacity-10 border-${tone} border-opacity-25`}>
      <div className="d-flex gap-3">
        <div className={`icon-shape icon-md bg-${tone} text-white rounded-2`}>
          <i className={`ti ${icon} fs-4`}></i>
        </div>
        <div className="min-w-0">
          <h2 className="mb-3 fs-6">{label}</h2>
          <h3 className="fw-bold mb-0 dashboard-card-value">{value}</h3>
          <p className={`mb-0 small text-${tone}`}>{note}</p>
        </div>
      </div>
    </div>
  )
}

function PreviewItem({ label, value }) {
  return (
    <div className="preview-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default ReportsPage
