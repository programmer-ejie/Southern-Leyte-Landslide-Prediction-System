import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'
import { API_BASE_URL, applyTheme, getStoredTheme, loadSavedTheme, saveTheme } from './theme-settings'

const ALERTS_PER_PAGE = 13

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

function formatTimestamp(value) {
  if (!value) {
    return 'No timestamp'
  }

  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))
}

function buildAlerts(alertPayload) {
  return [...(alertPayload?.alerts ?? [])]
    .map((alert) => ({
      id: alert.id,
      name: alert.name,
      riskLevel: alert.riskLevel,
      probability: alert.probability ?? 0,
      severity: alert.severity,
      priority: alert.priority ?? 0,
      status: alert.status ?? 'Watch',
      classificationBasis: alert.classificationBasis,
      loss: alert.loss,
      locationSummary: alert.locationSummary,
      municipalities: alert.municipalities ?? [],
      barangays: alert.barangays ?? [],
      feedTimestamp: alert.feedTimestamp ?? alert.updatedAt ?? alert.createdAt,
      dataSource: alert.data_source ?? alert.dataSource,
      modelName: alert.model_name ?? alert.modelName,
      sourceDetail: alert.source_detail ?? alert.sourceDetail,
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function AlertsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [alertStatus, setAlertStatus] = useState('loading')
  const [alertPayload, setAlertPayload] = useState(null)
  const [themeMode, setThemeMode] = useState(
    getStoredTheme,
  )
  const [selectedAlertId, setSelectedAlertId] = useState(null)
  const [alertPage, setAlertPage] = useState(1)

  const alerts = useMemo(() => buildAlerts(alertPayload), [alertPayload])
  const totalAlertPages = Math.max(1, Math.ceil(alerts.length / ALERTS_PER_PAGE))
  const pagedAlerts = alerts.slice(
    (alertPage - 1) * ALERTS_PER_PAGE,
    alertPage * ALERTS_PER_PAGE,
  )
  const selectedAlert =
    alerts.find((alert) => alert.id === selectedAlertId) ?? alerts[0] ?? null
  const activeAlertItems = alerts
  const severityDistribution = useMemo(
    () => buildSeverityDistribution(activeAlertItems),
    [activeAlertItems],
  )
  const donutGradient = buildDonutGradient(severityDistribution)
  const activeAlerts = activeAlertItems.filter((alert) => alert.priority >= 45).length
  const criticalAlerts = activeAlertItems.filter(
    (alert) => alert.severity === 'Critical',
  ).length
  const affectedPeople = activeAlertItems.reduce(
    (sum, alert) => sum + (alert.loss?.estimated_affected_people ?? 0),
    0,
  )
  const evacuationWatch = activeAlertItems.filter(
    (alert) => alert.priority >= 70,
  ).length
  const maxSeverityCount = Math.max(
    1,
    ...severityDistribution.map((item) => item.count),
  )

  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    loadSavedTheme(setThemeMode)
  }, [])

  useEffect(() => {
    setAlertPage(1)
  }, [alerts.length])

  useEffect(() => {
    if (alertPage > totalAlertPages) {
      setAlertPage(totalAlertPages)
    }
  }, [alertPage, totalAlertPages])

  useEffect(() => {
    let isMounted = true

    function checkApiHealth() {
      axios
        .get(`${API_BASE_URL}/health`)
        .then(() => {
          if (isMounted) setApiStatus('connected')
        })
        .catch(() => {
          if (isMounted) setApiStatus('offline')
        })
    }

    checkApiHealth()
    const intervalId = window.setInterval(checkApiHealth, 30000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    setAlertStatus('loading')
    axios
      .get(`${API_BASE_URL}/alerts`)
      .then((response) => {
        setAlertPayload(response.data)
        setAlertStatus('loaded')
      })
      .catch(() => setAlertStatus('unavailable'))
  }, [])

  function exportAlerts() {
    const rows = alerts.map((alert) => ({
      id: alert.id,
      name: alert.name,
      riskLevel: alert.riskLevel,
      probability: `${Math.round(alert.probability * 100)}%`,
      severity: alert.severity,
      priority: alert.priority,
      status: alert.status,
      location: alert.locationSummary ?? '',
      feedTimestamp: formatTimestamp(alert.feedTimestamp),
      dataSource: alert.dataSource ?? '',
      modelName: alert.modelName ?? '',
      affectedPeople: alert.loss?.estimated_affected_people ?? 0,
      economicLossPhp: alert.loss?.estimated_economic_loss_php ?? 0,
    }))
    const csvHeaders = Object.keys(rows[0] ?? { message: 'No alerts available' })
    const csvLines = [
      csvHeaders.join(','),
      ...rows.map((row) =>
        csvHeaders
          .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
          .join(','),
      ),
    ]
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'alerts.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  function printSelectedAdvisory() {
    if (!selectedAlert) {
      return
    }

    const generatedAt = new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    }).format(new Date())
    const logoUrl = `${window.location.origin}/website_logo.webp`
    const location = selectedAlert.locationSummary ?? 'Southern Leyte'
    const municipalities = selectedAlert.municipalities.length
      ? selectedAlert.municipalities
          .map(
            (municipality) =>
              `${municipality.name} (${municipality.barangay_count} barangays)`,
          )
          .join(', ')
      : 'No municipality overlap available.'
    const barangayRows = selectedAlert.barangays.length
      ? selectedAlert.barangays
          .slice(0, 8)
          .map(
            (barangay) => `
              <tr>
                <td>${escapeHtml(barangay.barangay)}</td>
                <td>${escapeHtml(barangay.municipality)}</td>
                <td>${formatNumber(barangay.coverage_percent)}%</td>
                <td>${formatNumber(barangay.estimated_affected_people)}</td>
                <td>${formatPeso(barangay.estimated_economic_loss_php)}</td>
              </tr>
            `,
          )
          .join('')
      : `
          <tr>
            <td colspan="5">No barangay overlap available.</td>
          </tr>
        `
    const advisoryHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Public Advisory - ${escapeHtml(selectedAlert.name)}</title>
          <style>
            @page { size: A4; margin: 18mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              color: #111827;
              font-family: Arial, Helvetica, sans-serif;
              line-height: 1.45;
            }
            .letter {
              max-width: 760px;
              margin: 0 auto;
            }
            .header {
              display: flex;
              align-items: center;
              gap: 16px;
              padding-bottom: 16px;
              border-bottom: 3px solid #1d4ed8;
            }
            .header img {
              width: 72px;
              height: 72px;
              object-fit: contain;
            }
            .system-title {
              margin: 0;
              color: #0f172a;
              font-size: 20px;
              font-weight: 800;
            }
            .system-subtitle {
              margin: 4px 0 0;
              color: #475569;
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            .document-title {
              margin: 24px 0 4px;
              color: #991b1b;
              font-size: 24px;
              font-weight: 900;
              text-align: center;
              text-transform: uppercase;
            }
            .date {
              margin: 0 0 22px;
              color: #475569;
              font-size: 12px;
              text-align: center;
            }
            .summary {
              padding: 14px 16px;
              border: 1px solid #bfdbfe;
              border-left: 5px solid #2563eb;
              background: #eff6ff;
            }
            .summary strong {
              display: block;
              margin-bottom: 4px;
              font-size: 15px;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 10px;
              margin: 18px 0;
            }
            .box {
              padding: 12px;
              border: 1px solid #dbe4f0;
              border-radius: 8px;
            }
            .box span {
              display: block;
              color: #64748b;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
            }
            .box strong {
              display: block;
              margin-top: 6px;
              font-size: 17px;
            }
            h2 {
              margin: 22px 0 8px;
              color: #0f172a;
              font-size: 16px;
            }
            p {
              margin: 0 0 10px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 8px;
              font-size: 12px;
            }
            th,
            td {
              padding: 8px;
              border: 1px solid #dbe4f0;
              text-align: left;
              vertical-align: top;
            }
            th {
              background: #f1f5f9;
              color: #334155;
              font-size: 11px;
              text-transform: uppercase;
            }
            .notice {
              margin-top: 18px;
              padding: 12px;
              border: 1px solid #fecaca;
              background: #fef2f2;
              color: #7f1d1d;
              font-weight: 700;
            }
            .footer {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 32px;
              margin-top: 42px;
              font-size: 12px;
            }
            .signature {
              padding-top: 36px;
              border-top: 1px solid #94a3b8;
              text-align: center;
            }
            @media print {
              body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <main class="letter">
            <header class="header">
              <img src="${logoUrl}" alt="Southern Leyte Landslide Prediction logo" />
              <div>
                <h1 class="system-title">Southern Leyte Landslide Prediction System</h1>
                <p class="system-subtitle">Geospatial risk intelligence and rainfall scenario monitoring</p>
              </div>
            </header>

            <h2 class="document-title">Public Advisory</h2>
            <p class="date">Generated ${escapeHtml(generatedAt)}</p>

            <section class="summary">
              <strong>${escapeHtml(selectedAlert.name)}</strong>
              <p>${escapeHtml(location)} is under ${escapeHtml(selectedAlert.riskLevel)} risk monitoring. Residents in affected barangays should follow local advisories and avoid steep or saturated slopes.</p>
            </section>

            <section class="grid">
              <div class="box"><span>Severity</span><strong>${escapeHtml(selectedAlert.severity)}</strong></div>
              <div class="box"><span>Probability</span><strong>${Math.round(selectedAlert.probability * 100)}%</strong></div>
              <div class="box"><span>Estimated affected people</span><strong>${formatNumber(selectedAlert.loss?.estimated_affected_people)}</strong></div>
              <div class="box"><span>Estimated economic loss</span><strong>${formatPeso(selectedAlert.loss?.estimated_economic_loss_php)}</strong></div>
              <div class="box"><span>Possible casualties</span><strong>${formatNumber(selectedAlert.loss?.estimated_possible_casualties)}</strong></div>
              <div class="box"><span>Status</span><strong>${escapeHtml(selectedAlert.status)}</strong></div>
            </section>

            <h2>Affected Municipalities</h2>
            <p>${escapeHtml(municipalities)}</p>

            <h2>Top Affected Barangays</h2>
            <table>
              <thead>
                <tr>
                  <th>Barangay</th>
                  <th>Municipality</th>
                  <th>Coverage</th>
                  <th>Affected People</th>
                  <th>Economic Loss</th>
                </tr>
              </thead>
              <tbody>${barangayRows}</tbody>
            </table>

            <h2>Recommended Action</h2>
            <p>${escapeHtml(selectedAlert.loss?.recommendation)}</p>

            <div class="notice">
              This is a planning advisory generated from model predictions and exposure estimates. Validate with LGU field reports before final evacuation or road closure decisions.
            </div>

            <footer class="footer">
              <div class="signature">Prepared by</div>
              <div class="signature">Authorized official</div>
            </footer>
          </main>
          <script>
            window.addEventListener('load', function () {
              window.print();
            });
          </script>
        </body>
      </html>
    `
    const advisoryWindow = window.open('', '_blank', 'width=900,height=1100')

    if (!advisoryWindow) {
      return
    }

    advisoryWindow.document.open()
    advisoryWindow.document.write(advisoryHtml)
    advisoryWindow.document.close()
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
              onClick={() => {
                const nextThemeMode = themeMode === 'dark' ? 'light' : 'dark'
                setThemeMode(nextThemeMode)
                saveTheme(nextThemeMode)
              }}
              aria-label="Toggle theme"
            >
              <i
                className={`ti ${
                  themeMode === 'dark' ? 'ti-sun' : 'ti-moon'
                } fs-5`}
              ></i>
            </button>
          </li>
          <AdminAlertDropdown alertsPayload={alertPayload} />
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
                note={alertStatus}
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
              <div className="card" id="alerts-feed">
                <div className="card-header bg-white px-4 py-3 alert-feed-header">
                  <h4 className="mb-0 h5">Alert Feed</h4>
                  <div className="alert-feed-header-actions">
                    <div className="alert-pagination alert-pagination--header">
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        disabled={alertPage === 1}
                        onClick={() => setAlertPage((page) => Math.max(1, page - 1))}
                      >
                        <i className="ti ti-chevron-left"></i>
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
                        <i className="ti ti-chevron-right"></i>
                      </button>
                    </div>
                  </div>
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
                            {alert.riskLevel} risk -{' '}
                            {Math.round(alert.probability * 100)}% probability
                            {alert.locationSummary
                              ? ` - ${alert.locationSummary}`
                              : ''}
                          </span>
                          <small className="alert-feed-meta">
                            <i className="ti ti-clock"></i>
                            {formatTimestamp(alert.feedTimestamp)}
                            <i className="ti ti-cpu"></i>
                            {alert.dataSource ?? 'Model prediction'}
                            <i className="ti ti-brain"></i>
                            {alert.modelName ?? 'Attention U-Net'}
                          </small>
                        </div>
                        <span className="priority-score">{alert.priority}</span>
                      </button>
                    ))}
                    {alerts.length === 0 && (
                      <p className="text-secondary mb-0">No alerts available.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-5">
              <div className="card h-100 alert-detail-card">
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
                      <div className="alert-detail-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={printSelectedAdvisory}
                        >
                          <i className="ti ti-printer me-1"></i>
                          Print Advisory
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={exportAlerts}
                        >
                          <i className="ti ti-file-export me-1"></i>
                          Export Alert List
                        </button>
                      </div>
                      <div className="alert-detail-grid">
                        <PreviewDatum
                          label="Risk"
                          value={selectedAlert.riskLevel}
                        />
                        <PreviewDatum
                          label="Location"
                          value={selectedAlert.locationSummary ?? 'Southern Leyte'}
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
                          label="Auto status"
                          value={selectedAlert.status}
                        />
                        <PreviewDatum
                          label="Feed timestamp"
                          value={formatTimestamp(selectedAlert.feedTimestamp)}
                        />
                        <PreviewDatum
                          label="Source"
                          value={selectedAlert.dataSource ?? 'Model prediction'}
                        />
                        <PreviewDatum
                          label="Model"
                          value={selectedAlert.modelName ?? 'Attention U-Net'}
                        />
                        <PreviewDatum
                          label="Economic loss"
                          value={formatPeso(
                            selectedAlert.loss?.estimated_economic_loss_php,
                          )}
                        />
                        <PreviewDatum
                          label="Possible casualties"
                          value={formatNumber(
                            selectedAlert.loss?.estimated_possible_casualties,
                          )}
                        />
                      </div>
                      <div className="report-recommendation">
                        <strong>Automatic classification basis</strong>
                        <span>
                          {selectedAlert.classificationBasis ??
                            'Automatically classified from model risk, priority score, and exposure estimates.'}
                        </span>
                      </div>
                      <div className="report-recommendation">
                        <strong>Affected municipalities</strong>
                        <span>
                          {selectedAlert.municipalities.length
                            ? selectedAlert.municipalities
                                .map(
                                  (municipality) =>
                                    `${municipality.name} (${municipality.barangay_count} barangays)`,
                                )
                                .join(', ')
                            : 'No municipality overlap available.'}
                        </span>
                      </div>
                      <div className="advisory-template">
                        <strong>Top affected barangays</strong>
                        <div className="alert-location-list">
                          {selectedAlert.barangays.slice(0, 6).map((barangay) => (
                            <div
                              className="alert-location-item"
                              key={`${barangay.municipality}-${barangay.barangay}`}
                            >
                              <span>
                                <strong>{barangay.barangay}</strong>
                                {barangay.municipality}
                              </span>
                              <em>
                                {formatNumber(barangay.estimated_affected_people)} people
                                {' / '}
                                {formatPeso(barangay.estimated_economic_loss_php)}
                              </em>
                            </div>
                          ))}
                          {selectedAlert.barangays.length === 0 && (
                            <span>No barangay overlap available.</span>
                          )}
                        </div>
                      </div>
                      <div className="report-recommendation">
                        <strong>Recommended action</strong>
                        <span>{selectedAlert.loss?.recommendation}</span>
                      </div>
                      <div className="advisory-template">
                        <strong>Advisory message</strong>
                        <span>
                          {selectedAlert.locationSummary ?? selectedAlert.name} is under{' '}
                          {selectedAlert.riskLevel} risk monitoring. Residents in
                          affected barangays should follow local advisories and avoid
                          steep or saturated slopes.
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
            <div className="col-12">
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
