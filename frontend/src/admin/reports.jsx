import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'
import { API_BASE_URL, applyTheme, getStoredTheme, loadSavedTheme, saveTheme } from './theme-settings'


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

const GENERATED_REPORTS_PER_PAGE = 5

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

function formatCompactPeso(value) {
  const amount = Number(value ?? 0)

  if (Math.abs(amount) >= 1_000_000_000) {
    return `PHP ${(amount / 1_000_000_000).toFixed(2)}B`
  }

  if (Math.abs(amount) >= 1_000_000) {
    return `PHP ${(amount / 1_000_000).toFixed(2)}M`
  }

  if (Math.abs(amount) >= 1_000) {
    return `PHP ${(amount / 1_000).toFixed(1)}K`
  }

  return formatPeso(amount)
}

function formatTimestamp(value) {
  if (!value) {
    return 'Not generated'
  }

  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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

function buildDecisionTreeRecommendation({
  highRiskZones,
  latestProbability,
  affectedPeople,
  economicLoss,
}) {
  if (highRiskZones > 0 && latestProbability >= 0.75) {
    return {
      level: 'Immediate response',
      text: 'Decision tree result: High or very high probability zones are present. Prioritize field validation, barangay advisories, evacuation readiness, and road closure review for exposed areas.',
    }
  }

  if (affectedPeople >= 50000 || economicLoss >= 1000000000) {
    return {
      level: 'Preparedness escalation',
      text: 'Decision tree result: Exposure is high even if the top probability is moderate. Prepare response resources, validate exposed barangays, and coordinate with municipal disaster teams.',
    }
  }

  if (latestProbability >= 0.45) {
    return {
      level: 'Monitoring',
      text: 'Decision tree result: Moderate risk is present. Continue rainfall and slope monitoring, inspect drainage, and keep barangay officials informed.',
    }
  }

  return {
    level: 'Routine watch',
    text: 'Decision tree result: No high-priority trigger is currently present. Maintain routine monitoring and update the report after new rainfall or model data.',
  }
}

function ReportsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [riskStatus, setRiskStatus] = useState('loading')
  const [riskZones, setRiskZones] = useState(null)
  const [themeMode, setThemeMode] = useState(
    getStoredTheme,
  )
  const [selectedMunicipality, setSelectedMunicipality] = useState('Bontoc')
  const [selectedReportType, setSelectedReportType] = useState('Risk Summary')
  const [selectedFormat, setSelectedFormat] = useState('PDF')
  const [generatedReports, setGeneratedReports] = useState([])
  const [reportStatus, setReportStatus] = useState('idle')
  const [currentReport, setCurrentReport] = useState(null)
  const [reportsPage, setReportsPage] = useState(1)

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
  const decisionRecommendation = useMemo(
    () =>
      buildDecisionTreeRecommendation({
        highRiskZones,
        latestProbability,
        affectedPeople: lossSummary.people,
        economicLoss: lossSummary.economicLoss,
      }),
    [highRiskZones, latestProbability, lossSummary.economicLoss, lossSummary.people],
  )
  const totalReportPages = Math.max(
    1,
    Math.ceil(generatedReports.length / GENERATED_REPORTS_PER_PAGE),
  )
  const pagedGeneratedReports = generatedReports.slice(
    (reportsPage - 1) * GENERATED_REPORTS_PER_PAGE,
    reportsPage * GENERATED_REPORTS_PER_PAGE,
  )

  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    loadSavedTheme(setThemeMode)
  }, [])

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

  useEffect(() => {
    loadGeneratedReports()
  }, [])

  useEffect(() => {
    setReportsPage(1)
  }, [generatedReports.length])

  useEffect(() => {
    if (reportsPage > totalReportPages) {
      setReportsPage(totalReportPages)
    }
  }, [reportsPage, totalReportPages])

  function loadGeneratedReports() {
    return axios
      .get(`${API_BASE_URL}/reports`)
      .then((response) => setGeneratedReports(response.data?.reports ?? []))
      .catch(() => setGeneratedReports([]))
  }

  function generateReportPayload(format = selectedFormat) {
    setReportStatus('generating')

    return axios
      .post(`${API_BASE_URL}/reports`, {
        municipality: selectedMunicipality,
        report_type: selectedReportType,
        format,
      })
      .then((response) => {
        const report = response.data?.report
        setCurrentReport(report)
        setGeneratedReports((reports) => [report, ...reports.filter((item) => item.id !== report.id)])
        setReportStatus('generated')
        return report
      })
      .catch((error) => {
        setReportStatus('failed')
        throw error
      })
  }

  function reportCsvRows(report) {
    const payload = report?.payload ?? {}
    return payload.focus_rows?.length
      ? payload.focus_rows.map((row) => ({ report: report.name, ...row }))
      : (payload.top_barangays ?? []).map((barangay) => ({
          report: report.name,
          municipality: barangay.municipality,
          barangay: barangay.barangay,
          coveragePercent: barangay.max_coverage_percent,
          affectedPeople: barangay.estimated_affected_people,
          economicLossPhp: barangay.estimated_economic_loss_php,
          possibleCasualties: barangay.estimated_possible_casualties,
        }))
  }

  function downloadReportCsv(report) {
    const rows = reportCsvRows(report)
    const headers = Object.keys(rows[0] ?? { message: 'No barangay rows available' })
    const csvLines = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
          .join(','),
      ),
    ]
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${report.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function printReportDocument(report) {
    const payload = report?.payload ?? {}
    const summary = payload.summary ?? report?.summary ?? {}
    const logoUrl = `${window.location.origin}/website_logo.webp`
    const generatedAt = formatTimestamp(report?.createdAt ?? payload.generated_at)
    const focusColumns = payload.focus_columns ?? []
    const focusRows = payload.focus_rows ?? []
    const focusHeader = focusColumns
      .map((column) => `<th>${escapeHtml(column)}</th>`)
      .join('')
    const formatReportCell = (column, value) => {
      if (/loss/i.test(column)) return formatPeso(value)
      if (/people|casualt|zones|duration|saturation|rainfall|coverage/i.test(column)) {
        return /coverage/i.test(column) ? `${formatNumber(value)}%` : formatNumber(value)
      }
      return escapeHtml(value)
    }
    const focusBody = focusRows
      .map(
        (row) => `
          <tr>
            ${focusColumns
              .map((column) => `<td>${formatReportCell(column, row[column])}</td>`)
              .join('')}
          </tr>
        `,
      )
      .join('')
    const reportHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(report.name)}</title>
          <style>
            @page { size: A4; margin: 16mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              color: #111827;
              font-family: Arial, Helvetica, sans-serif;
              line-height: 1.45;
            }
            .document {
              max-width: 780px;
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
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }
            .title {
              margin: 24px 0 4px;
              color: #1d4ed8;
              font-size: 24px;
              font-weight: 900;
              text-align: center;
              text-transform: uppercase;
            }
            .meta {
              margin: 0 0 20px;
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
            .grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
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
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
            }
            .box strong {
              display: block;
              margin-top: 5px;
              font-size: 15px;
            }
            h2 {
              margin: 22px 0 8px;
              color: #0f172a;
              font-size: 16px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 8px;
              font-size: 11px;
            }
            th,
            td {
              padding: 7px;
              border: 1px solid #dbe4f0;
              text-align: left;
              vertical-align: top;
            }
            th {
              background: #f1f5f9;
              color: #334155;
              font-size: 10px;
              text-transform: uppercase;
            }
            .notice {
              margin-top: 18px;
              padding: 12px;
              border: 1px solid #fde68a;
              background: #fffbeb;
              color: #78350f;
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
          <main class="document">
            <header class="header">
              <img src="${logoUrl}" alt="Southern Leyte Landslide Prediction logo" />
              <div>
                <h1 class="system-title">Southern Leyte Landslide Prediction System</h1>
                <p class="system-subtitle">Geospatial risk intelligence and rainfall scenario monitoring</p>
              </div>
            </header>
            <h2 class="title">${escapeHtml(report.name)}</h2>
            <p class="meta">Generated ${escapeHtml(generatedAt)} · ${escapeHtml(report.reportType)} · ${escapeHtml(report.format)}</p>
            <section class="summary">
              <strong>Report Summary</strong>
              <p>${escapeHtml(payload.recommendation)}</p>
            </section>
            <section class="grid">
              <div class="box"><span>Risk zones</span><strong>${formatNumber(summary.risk_zones)}</strong></div>
              <div class="box"><span>High risk zones</span><strong>${formatNumber(summary.high_risk_zones)}</strong></div>
              <div class="box"><span>Highest probability</span><strong>${Math.round((summary.highest_probability ?? 0) * 100)}%</strong></div>
              <div class="box"><span>Affected people</span><strong>${formatNumber(summary.affected_people)}</strong></div>
              <div class="box"><span>Economic loss</span><strong>${formatPeso(summary.economic_loss_php)}</strong></div>
              <div class="box"><span>Possible casualties</span><strong>${formatNumber(summary.possible_casualties)}</strong></div>
            </section>
            <h2>${escapeHtml(payload.focus_title ?? 'Report Details')}</h2>
            <table>
              <thead><tr>${focusHeader}</tr></thead>
              <tbody>${focusBody || `<tr><td colspan="${Math.max(focusColumns.length, 1)}">No rows available.</td></tr>`}</tbody>
            </table>
            <div class="notice">
              Planning report generated from model predictions and exposure estimates. Validate with LGU field reports before final operational decisions.
            </div>
            <footer class="footer">
              <div class="signature">Prepared by</div>
              <div class="signature">Authorized official</div>
            </footer>
          </main>
          <script>
            window.addEventListener('load', function () { window.print(); });
          </script>
        </body>
      </html>
    `
    const reportWindow = window.open('', '_blank', 'width=900,height=1100')
    if (!reportWindow) return
    reportWindow.document.open()
    reportWindow.document.write(reportHtml)
    reportWindow.document.close()
  }

  function handleGenerateReport() {
    generateReportPayload(selectedFormat).then((report) => {
      if (selectedFormat === 'CSV') {
        downloadReportCsv(report)
      } else {
        printReportDocument(report)
      }
    })
  }

  function handlePrintReport() {
    generateReportPayload('Print').then((report) => {
      printReportDocument(report)
    })
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
                value={formatCompactPeso(lossSummary.economicLoss)}
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
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleGenerateReport}
                      disabled={reportStatus === 'generating'}
                    >
                      <i className="ti ti-file-export me-1"></i>
                      {reportStatus === 'generating'
                        ? 'Generating...'
                        : `Generate ${selectedFormat}`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={handlePrintReport}
                      disabled={reportStatus === 'generating'}
                    >
                      <i className="ti ti-printer me-1"></i>
                      Print
                    </button>
                  </div>
                  {reportStatus === 'generated' && (
                    <p className="small text-success mt-3 mb-0">
                      Report generated and saved to history.
                    </p>
                  )}
                  {reportStatus === 'failed' && (
                    <p className="small text-danger mt-3 mb-0">
                      Report generation failed. Check the backend connection.
                    </p>
                  )}
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
                      <h3>{currentReport?.name ?? `${selectedMunicipality} ${selectedReportType}`}</h3>
                      <p>
                        {currentReport
                          ? `Generated ${formatTimestamp(currentReport.createdAt)}`
                          : 'Latest model output summary for selected administrative area.'}
                      </p>
                    </div>
                    <div className="report-preview-grid">
                      <PreviewItem
                        label="Risk zones"
                        value={formatNumber(
                          currentReport?.summary?.risk_zones ?? mappedZones,
                        )}
                      />
                      <PreviewItem
                        label="Highest probability"
                        value={`${Math.round(
                          (currentReport?.summary?.highest_probability ??
                            latestProbability) * 100,
                        )}%`}
                      />
                      <PreviewItem
                        label="Affected people"
                        value={formatNumber(
                          currentReport?.summary?.affected_people ??
                            lossSummary.people,
                        )}
                      />
                      <PreviewItem
                        label="Economic loss"
                        value={formatCompactPeso(
                          currentReport?.summary?.economic_loss_php ??
                            lossSummary.economicLoss,
                        )}
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
                  <div className="report-recommendation mt-4">
                    <strong>{decisionRecommendation.level}</strong>
                    <span>{decisionRecommendation.text}</span>
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
                      {pagedGeneratedReports.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.municipality}</td>
                          <td>{row.reportType}</td>
                          <td>
                            <span className="badge bg-primary-subtle text-primary text-capitalize">
                              {row.status}
                            </span>
                          </td>
                          <td className="text-end">
                            <button
                              type="button"
                              className="btn btn-sm btn-light"
                              onClick={() => {
                                setCurrentReport(row)
                                printReportDocument(row)
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                      {generatedReports.length === 0 && (
                        <tr>
                          <td colSpan="5" className="text-center text-secondary py-4">
                            No generated reports yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {generatedReports.length > GENERATED_REPORTS_PER_PAGE && (
                  <div className="alert-pagination reports-pagination px-4 pb-4">
                    <button
                      type="button"
                      className="btn btn-light btn-sm"
                      disabled={reportsPage === 1}
                      onClick={() => setReportsPage((page) => Math.max(1, page - 1))}
                    >
                      <i className="ti ti-chevron-left"></i>
                      Previous
                    </button>
                    <span>
                      Page {reportsPage} of {totalReportPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-light btn-sm"
                      disabled={reportsPage === totalReportPages}
                      onClick={() =>
                        setReportsPage((page) => Math.min(totalReportPages, page + 1))
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
    <div className={`card report-metric-card p-4 border rounded-2 h-100 bg-${tone} bg-opacity-10 border-${tone} border-opacity-25`}>
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
