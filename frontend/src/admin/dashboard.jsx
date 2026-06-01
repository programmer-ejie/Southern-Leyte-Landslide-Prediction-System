import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { GeoJSON, ImageOverlay, MapContainer, Pane, TileLayer } from 'react-leaflet'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'
import { API_BASE_URL, applyTheme, getStoredTheme, loadSavedTheme, saveTheme } from './theme-settings'

const SOUTHERN_LEYTE_POSITION = [10.22, 125.05]
const SOUTHERN_LEYTE_BOUNDS = [
  [9.78, 124.68],
  [10.66, 125.42],
]
const BASELINE_RISK_IMAGE_BOUNDS = [
  [9.88, 124.62],
  [10.55, 125.35],
]

const riskStyles = {
  '100%': { color: '#7f1d1d', fillColor: '#dc2626', fillOpacity: 0.48, weight: 2 },
  '75%': { color: '#b45309', fillColor: '#f97316', fillOpacity: 0.42, weight: 2 },
  '50%': { color: '#a16207', fillColor: '#facc15', fillOpacity: 0.36, weight: 2 },
  '30%': { color: '#4d7c0f', fillColor: '#84cc16', fillOpacity: 0.3, weight: 2 },
  '15%': { color: '#166534', fillColor: '#22c55e', fillOpacity: 0.24, weight: 2 },
  High: { color: '#991b1b', fillColor: '#ef4444', fillOpacity: 0.42, weight: 2 },
  Medium: { color: '#b45309', fillColor: '#f59e0b', fillOpacity: 0.38, weight: 2 },
  Low: { color: '#166534', fillColor: '#22c55e', fillOpacity: 0.32, weight: 2 },
}

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

const compactCurrencyFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 2,
  notation: 'compact',
  compactDisplay: 'short',
})

function formatNumber(value) {
  return numberFormatter.format(value ?? 0)
}

const riskPaneByLevel = {
  Low: 'risk-low',
  Medium: 'risk-medium',
  High: 'risk-high',
  '15%': 'risk-15',
  '30%': 'risk-30',
  '50%': 'risk-50',
  '75%': 'risk-75',
  '100%': 'risk-100',
}

function formatPeso(value) {
  return `PHP ${currencyFormatter.format(value ?? 0)}`
}

function formatCompactPeso(value) {
  return `PHP ${compactCurrencyFormatter.format(value ?? 0)}`
}

function getRiskStyle(feature) {
  const style = riskStyles[feature.properties.risk_level] ?? riskStyles.Low

  if (feature.properties.name?.startsWith('Baseline Hazard')) {
    return {
      ...style,
      color: style.fillColor,
      fillColor: style.fillColor,
      fillOpacity: 0.46,
      opacity: 0.42,
      stroke: true,
      weight: 0.65,
    }
  }

  return style
}

function getActiveLayerInfo(riskZones) {
  const firstName = riskZones?.features?.[0]?.properties?.name ?? ''

  if (firstName.startsWith('Baseline Hazard')) {
    return 'Primary layer: baseline hazard + local tensor'
  }

  if (firstName.startsWith('Live Rainfall Prediction')) {
    return 'Primary layer: live rainfall + baseline hazard + local tensor'
  }

  if (firstName.startsWith('Rainfall Simulation')) {
    return 'Primary layer: rainfall scenario + local tensor'
  }

  if (firstName.startsWith('Attention U-Net')) {
    return 'Primary layer: Attention U-Net + local tensor'
  }

  return 'Primary prediction layer from database'
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

function getHighestRiskZones(riskZones) {
  return [...(riskZones?.features ?? [])]
    .sort((featureA, featureB) => {
      const probabilityA = featureA.properties.probability ?? 0
      const probabilityB = featureB.properties.probability ?? 0

      return probabilityB - probabilityA
    })
    .slice(0, 5)
}

function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const apiHasConnectedRef = useRef(false)
  const [riskStatus, setRiskStatus] = useState('loading')
  const [riskZones, setRiskZones] = useState(null)
  const [provinceBoundary, setProvinceBoundary] = useState(null)
  const [provinceStatus, setProvinceStatus] = useState('loading')
  const [municipalityBoundaries, setMunicipalityBoundaries] = useState(null)
  const [municipalityStatus, setMunicipalityStatus] = useState('loading')
  const [barangayBoundaries, setBarangayBoundaries] = useState(null)
  const [barangayStatus, setBarangayStatus] = useState('loading')
  const [baselineOverlayStatus, setBaselineOverlayStatus] = useState('idle')
  const [showMapLoader, setShowMapLoader] = useState(true)
  const [themeMode, setThemeMode] = useState(
    getStoredTheme,
  )

  function markApiConnected() {
    apiHasConnectedRef.current = true
    setApiStatus('connected')
  }

  const lossSummary = useMemo(() => buildLossSummary(riskZones), [riskZones])
  const riskDistribution = useMemo(
    () => buildRiskDistribution(riskZones),
    [riskZones],
  )
  const highestRiskZones = useMemo(() => getHighestRiskZones(riskZones), [riskZones])
  const mappedZones = riskZones?.features?.length ?? 0
  const hasBaselineRiskLayer = riskZones?.features?.some((feature) =>
    feature.properties.name?.startsWith('Baseline Hazard'),
  )
  const baselineOverlayVersion =
    riskZones?.features
      ?.filter((feature) => feature.properties.name?.startsWith('Baseline Hazard'))
      .map((feature) => feature.properties.id)
      .join('-') || 'baseline'
  const activeLayerDetail = getActiveLayerInfo(riskZones)
  const shouldShowBaselineOverlay =
    hasBaselineRiskLayer ||
    riskZones?.features?.some((feature) =>
      /^(Live Rainfall Prediction|Rainfall Simulation)/.test(
        feature.properties.name ?? '',
      ),
    )
  const riskLayerVersion =
    riskZones?.features?.map((feature) => feature.properties.id).join('-') || 'empty'
  const displayedBaselineOverlayVersion = hasBaselineRiskLayer
    ? baselineOverlayVersion
    : `baseline-underlay-${riskLayerVersion}`
  const highRiskZones =
    riskZones?.features?.filter((feature) =>
      ['75%', '100%', 'High'].includes(feature.properties.risk_level),
    ).length ?? 0
  const maxDistributionCount = Math.max(
    1,
    ...riskDistribution.map((item) => item.count),
  )
  const totalDistributionCount = riskDistribution.reduce(
    (sum, item) => sum + item.count,
    0,
  )
  const donutGradient = buildDonutGradient(riskDistribution)
  const highestProbability = highestRiskZones[0]?.properties?.probability ?? 0
  const averageProbability =
    mappedZones > 0
      ? (riskZones?.features ?? []).reduce(
          (sum, feature) => sum + (feature.properties.probability ?? 0),
          0,
        ) / mappedZones
      : 0
  const isMapLoading =
    riskStatus === 'loading' ||
    provinceStatus === 'loading' ||
    municipalityStatus === 'loading' ||
    barangayStatus === 'loading' ||
    baselineOverlayStatus === 'loading'
  const mapLoaderChecklist = [
    {
      label: 'Prediction layer',
      detail: activeLayerDetail.replace('Primary layer: ', ''),
      status:
        riskStatus === 'loading'
          ? 'loading'
          : riskStatus === 'unavailable'
            ? 'error'
            : 'ready',
    },
    {
      label: 'Baseline overlay',
      detail: 'Local tensor hazard raster',
      status:
        !shouldShowBaselineOverlay
          ? 'ready'
          : baselineOverlayStatus === 'loading'
            ? 'loading'
            : baselineOverlayStatus === 'unavailable'
              ? 'error'
              : 'ready',
    },
    {
      label: 'Province boundary',
      detail: 'Southern Leyte mask',
      status:
        provinceStatus === 'loading'
          ? 'loading'
          : provinceStatus === 'unavailable'
            ? 'error'
            : 'ready',
    },
    {
      label: 'Municipalities',
      detail: 'Borders and municipality names',
      status:
        municipalityStatus === 'loading'
          ? 'loading'
          : municipalityStatus === 'unavailable'
            ? 'error'
            : 'ready',
    },
    {
      label: 'Barangays',
      detail: 'Barangay borders only',
      status:
        barangayStatus === 'loading'
          ? 'loading'
          : barangayStatus === 'unavailable'
            ? 'error'
            : 'ready',
    },
  ]

  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    loadSavedTheme(setThemeMode)
  }, [])

  useEffect(() => {
    if (isMapLoading) {
      setShowMapLoader(true)
      return undefined
    }

    const hideLoader = window.setTimeout(() => {
      setShowMapLoader(false)
    }, 850)

    return () => window.clearTimeout(hideLoader)
  }, [isMapLoading])

  useEffect(() => {
    if (shouldShowBaselineOverlay) {
      setBaselineOverlayStatus('loading')
      return
    }

    setBaselineOverlayStatus('idle')
  }, [displayedBaselineOverlayVersion, shouldShowBaselineOverlay])

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

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    setRiskStatus('loading')
    axios
      .get(`${API_BASE_URL}/risk-zones`)
      .then((response) => {
        markApiConnected()
        setRiskZones(response.data)
        setRiskStatus('loaded')
      })
      .catch(() => setRiskStatus('unavailable'))
  }, [])

  useEffect(() => {
    setProvinceStatus('loading')

    axios
      .get(`${API_BASE_URL}/province-boundary`)
      .then((response) => {
        markApiConnected()
        setProvinceBoundary(response.data)
        setProvinceStatus('loaded')
      })
      .catch(() => {
        setProvinceBoundary(null)
        setProvinceStatus('unavailable')
      })
  }, [])

  useEffect(() => {
    setMunicipalityStatus('loading')

    axios
      .get(`${API_BASE_URL}/municipality-boundaries`)
      .then((response) => {
        markApiConnected()
        setMunicipalityBoundaries(response.data)
        setMunicipalityStatus('loaded')
      })
      .catch(() => {
        setMunicipalityBoundaries(null)
        setMunicipalityStatus('unavailable')
      })
  }, [])

  useEffect(() => {
    setBarangayStatus('loading')

    axios
      .get(`${API_BASE_URL}/barangay-boundaries`)
      .then((response) => {
        markApiConnected()
        setBarangayBoundaries(response.data)
        setBarangayStatus('loaded')
      })
      .catch(() => {
        setBarangayBoundaries(null)
        setBarangayStatus('unavailable')
      })
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
            <a className="nav-link active" href="/admin/dashboard">
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
          id="toggleBtn"
          type="button"
          className="d-none d-lg-inline-flex btn btn-light btn-icon btn-sm"
          onClick={() => setSidebarCollapsed((isCollapsed) => !isCollapsed)}
          aria-label="Toggle sidebar"
        >
          <i className="ti ti-menu-2"></i>
        </button>

        <button
          id="mobileBtn"
          type="button"
          className="btn btn-light btn-icon btn-sm d-lg-none me-2"
          onClick={() => setSidebarOpen((isOpen) => !isOpen)}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <i className="ti ti-menu-2"></i>
        </button>

        <div className="me-auto topbar-heading">
          <div className="small text-secondary">Southern Leyte</div>
          <div className="fw-semibold">Dashboard</div>
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
                <span className="prediction-kicker">Operations overview</span>
                <h1 className="fs-3 mb-1">Dashboard</h1>
                <p className="text-secondary mb-0">
                  Province-wide risk posture, exposure estimates, and recent
                  prediction activity.
                </p>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-xl-3 col-md-6 col-12">
              <SummaryCard
                className="bg-primary bg-opacity-10 border-primary border-opacity-25"
                icon="ti-map-pin"
                iconClassName="bg-primary"
                label="Active Risk Zones"
                value={formatNumber(mappedZones)}
                note={riskStatus}
                noteClassName="text-primary text-capitalize"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <SummaryCard
                className="bg-danger bg-opacity-10 border-danger border-opacity-25"
                icon="ti-alert-triangle"
                iconClassName="bg-danger"
                label="High Risk Zones"
                value={formatNumber(highRiskZones)}
                note="Needs close monitoring"
                noteClassName="text-danger"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <SummaryCard
                className="bg-success bg-opacity-10 border-success border-opacity-25"
                icon="ti-users"
                iconClassName="bg-success"
                label="Affected People"
                value={formatNumber(lossSummary.people)}
                note="Planning estimate"
                noteClassName="text-success"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <SummaryCard
                className="bg-info bg-opacity-10 border-info border-opacity-25"
                icon="ti-cash-banknote"
                iconClassName="bg-info"
                label="Economic Exposure"
                value={formatCompactPeso(lossSummary.economicLoss)}
                note="Estimated loss"
                noteClassName="text-info"
              />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-8">
              <div className="card dashboard-map-card">
                <div className="card-header d-flex justify-content-between align-items-center bg-transparent px-4 py-3">
                  <div>
                    <h3 className="h5 mb-0">Southern Leyte Overview</h3>
                    <small className="text-secondary">{activeLayerDetail}</small>
                  </div>
                  <a className="btn btn-sm btn-outline-primary" href="/admin/prediction">
                    Open Map
                  </a>
                </div>
                <div className="card-body p-0">
                  <div className="dashboard-map-frame">
                    <MapContainer
                      center={SOUTHERN_LEYTE_POSITION}
                      zoom={10}
                      className="map-view"
                      dragging={false}
                      scrollWheelZoom={false}
                      doubleClickZoom={false}
                      touchZoom={false}
                      boxZoom={false}
                      keyboard={false}
                      maxBounds={SOUTHERN_LEYTE_BOUNDS}
                      zoomControl={false}
                    >
                      <TileLayer
                        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
                      />
                      <Pane name="dashboard-risk" style={{ zIndex: 420 }} />
                      <Pane name="barangay-boundary-lines" style={{ zIndex: 555 }} />
                      <Pane name="municipality-boundaries" style={{ zIndex: 565 }} />
                      <Pane name="municipality-labels" style={{ zIndex: 570 }} />
                      <Pane name="baseline-risk-image" style={{ zIndex: 490 }} />
                      <Pane name="risk-low" style={{ zIndex: 500 }} />
                      <Pane name="risk-medium" style={{ zIndex: 510 }} />
                      <Pane name="risk-high" style={{ zIndex: 520 }} />
                      <Pane name="risk-15" style={{ zIndex: 500 }} />
                      <Pane name="risk-30" style={{ zIndex: 510 }} />
                      <Pane name="risk-50" style={{ zIndex: 520 }} />
                      <Pane name="risk-75" style={{ zIndex: 530 }} />
                      <Pane name="risk-100" style={{ zIndex: 540 }} />
                      <Pane name="province-boundary" style={{ zIndex: 580 }} />
                      {shouldShowBaselineOverlay && (
                        <ImageOverlay
                          bounds={BASELINE_RISK_IMAGE_BOUNDS}
                          eventHandlers={{
                            load: () => setBaselineOverlayStatus('loaded'),
                            error: () => setBaselineOverlayStatus('unavailable'),
                          }}
                          pane="baseline-risk-image"
                          url={`${API_BASE_URL}/baseline-risk-overlay.png?v=${displayedBaselineOverlayVersion}`}
                          opacity={1}
                        />
                      )}
                      {provinceBoundary?.geometry && (
                        <GeoJSON
                          key="dashboard-southern-leyte-province-boundary"
                          data={provinceBoundary}
                          pane="province-boundary"
                          interactive={false}
                          style={{
                            className: 'province-boundary',
                            color: '#111827',
                            fillColor: '#111827',
                            fillOpacity: 0,
                            opacity: 1,
                            weight: hasBaselineRiskLayer ? 3.5 : 4,
                          }}
                        />
                      )}
                      {barangayBoundaries?.features?.length > 0 && (
                        <GeoJSON
                          key={`dashboard-barangays-${barangayBoundaries.features.length}`}
                          data={barangayBoundaries}
                          pane="barangay-boundary-lines"
                          interactive={false}
                          style={{
                            className: 'barangay-boundary dashboard-barangay-boundary',
                            color: '#111827',
                            fillColor: '#ffffff',
                            fillOpacity: 0,
                            opacity: 0.52,
                            weight: 0.7,
                          }}
                        />
                      )}
                      {municipalityBoundaries?.features?.length > 0 && (
                        <GeoJSON
                          key={`dashboard-municipalities-${municipalityBoundaries.features.length}`}
                          data={municipalityBoundaries}
                          pane="municipality-boundaries"
                          interactive={false}
                          style={{
                            className: 'dashboard-municipality-boundary',
                            color: '#0f172a',
                            fillColor: '#ffffff',
                            fillOpacity: 0,
                            opacity: 0.9,
                            weight: 1.4,
                          }}
                        />
                      )}
                      {municipalityBoundaries?.features?.length > 0 && (
                        <GeoJSON
                          key={`dashboard-municipality-labels-${municipalityBoundaries.features.length}`}
                          data={municipalityBoundaries}
                          pane="municipality-labels"
                          interactive={false}
                          style={{
                            color: 'transparent',
                            fillOpacity: 0,
                            opacity: 0,
                            weight: 0,
                          }}
                          onEachFeature={(municipalityFeature, layer) => {
                            layer.bindTooltip(municipalityFeature.properties.name, {
                              className: 'municipality-label dashboard-municipality-label',
                              direction: 'center',
                              permanent: true,
                            })
                          }}
                        />
                      )}
                      {riskZones?.features?.map((feature) => (
                        hasBaselineRiskLayer &&
                        feature.properties.name?.startsWith('Baseline Hazard') ? null : (
                        <GeoJSON
                          key={`${feature.properties.id}-${feature.properties.risk_level}`}
                          data={feature}
                          pane={
                            riskPaneByLevel[feature.properties.risk_level] ??
                            'dashboard-risk'
                          }
                          style={getRiskStyle}
                        />
                        )
                      ))}
                    </MapContainer>
                    {showMapLoader && (
                      <div className="prediction-loader" aria-live="polite">
                        <div className="prediction-loader-panel">
                          <span className="prediction-loader-ring"></span>
                          <div className="prediction-loader-content">
                            <strong>Loading overview map</strong>
                            <span>Preparing prediction, boundary, and label layers</span>
                            <ul className="prediction-loader-checklist">
                              {mapLoaderChecklist.map((item) => (
                                <li
                                  key={item.label}
                                  className={`prediction-loader-check prediction-loader-check--${item.status}`}
                                >
                                  <i
                                    className={`ti ${
                                      item.status === 'ready'
                                        ? 'ti-check'
                                        : item.status === 'error'
                                          ? 'ti-alert-circle'
                                          : 'ti-loader-2'
                                    }`}
                                  ></i>
                                  <span>
                                    <b>{item.label}</b>
                                    <small>{item.detail}</small>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-4">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Current Situation</h4>
                </div>
                <div className="card-body p-4">
                  <div className="situation-item">
                    <span>Risk data</span>
                    <strong className="text-capitalize">{riskStatus}</strong>
                  </div>
                  <div className="situation-item">
                    <span>API connection</span>
                    <strong className="text-capitalize">{apiStatus}</strong>
                  </div>
                  <div className="situation-item">
                    <span>Mapped area</span>
                    <strong>{formatNumber(lossSummary.area)} sq km</strong>
                  </div>
                  <div className="situation-item">
                    <span>Possible casualties</span>
                    <strong>{formatNumber(lossSummary.casualties)}</strong>
                  </div>
                  <div className="dashboard-callout">
                    <i className="ti ti-info-circle"></i>
                    <span>
                      Use the prediction map to inspect municipality and barangay-level
                      exposure.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3">
            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Risk Distribution</h4>
                </div>
                <div className="card-body p-4">
                  <div className="risk-figure-layout">
                    <div
                      className="risk-donut"
                      style={{ background: `conic-gradient(${donutGradient})` }}
                    >
                      <div className="risk-donut-center">
                        <strong>{formatNumber(totalDistributionCount)}</strong>
                        <span>Zones</span>
                      </div>
                    </div>

                    <div className="risk-bars">
                      {riskDistribution.length === 0 && (
                        <p className="text-secondary mb-0">
                          No risk distribution available.
                        </p>
                      )}
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
                                width: `${(item.count / maxDistributionCount) * 100}%`,
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
                  <h4 className="mb-0 h5">Probability Figure</h4>
                </div>
                <div className="card-body p-4">
                  <div className="probability-gauge">
                    <div
                      className="probability-gauge-fill"
                      style={{
                        transform: `rotate(${(1 - Math.max(0, Math.min(1, highestProbability))) * 180}deg)`,
                      }}
                    ></div>
                    <div className="probability-gauge-cover">
                      <strong>{Math.round(highestProbability * 100)}%</strong>
                      <span>Highest probability</span>
                    </div>
                  </div>
                  <div className="dashboard-figure-grid">
                    <div>
                      <span>Average probability</span>
                      <strong>{Math.round(averageProbability * 100)}%</strong>
                    </div>
                    <div>
                      <span>High risk share</span>
                      <strong>
                        {mappedZones
                          ? Math.round((highRiskZones / mappedZones) * 100)
                          : 0}
                        %
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mt-0">
            <div className="col-12 col-xl-6">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Highest Probability Zones</h4>
                </div>
                <div className="card-body p-4">
                  <div className="zone-list">
                    {highestRiskZones.map((feature) => (
                      <div className="zone-list-item" key={feature.properties.id}>
                        <div>
                          <strong>{feature.properties.name}</strong>
                          <span>
                            {riskLabelByLevel[feature.properties.risk_level] ??
                              feature.properties.risk_level}
                          </span>
                        </div>
                        <span className="zone-probability">
                          {Math.round((feature.properties.probability ?? 0) * 100)}%
                        </span>
                      </div>
                    ))}
                    {highestRiskZones.length === 0 && (
                      <p className="text-secondary mb-0">No prediction zones available.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-6">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Exposure Breakdown</h4>
                </div>
                <div className="card-body p-4">
                  <div className="exposure-grid">
                    <FigureTile
                      label="Mapped area"
                      value={`${formatNumber(lossSummary.area)} sq km`}
                      icon="ti-ruler-measure"
                    />
                    <FigureTile
                      label="Affected people"
                      value={formatNumber(lossSummary.people)}
                      icon="ti-users"
                    />
                    <FigureTile
                      label="Economic exposure"
                      value={formatCompactPeso(lossSummary.economicLoss)}
                      icon="ti-cash-banknote"
                    />
                    <FigureTile
                      label="Possible casualties"
                      value={formatNumber(lossSummary.casualties)}
                      icon="ti-first-aid-kit"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mt-0">
            <div className="col-12">
              <div className="card">
                <div className="card-header bg-white px-4 py-3">
                  <h4 className="mb-0 h5">Recent Activity</h4>
                </div>
                <div className="card-body p-4">
                  <div className="activity-list">
                    <ActivityItem
                      icon="ti-map-search"
                      title="Risk zones loaded"
                      text={`${formatNumber(mappedZones)} mapped zones available for review.`}
                    />
                    <ActivityItem
                      icon="ti-cloud-rain"
                      title="Rainfall simulation ready"
                      text="Scenario controls are available in Rainfall Simulation."
                    />
                    <ActivityItem
                      icon="ti-database"
                      title="Loss estimates prepared"
                      text={`${formatNumber(lossSummary.people)} people estimated across mapped exposure.`}
                    />
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
                  <span>Dashboard</span>
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

function SummaryCard({
  className,
  icon,
  iconClassName,
  label,
  value,
  valueClassName = '',
  note,
  noteClassName,
}) {
  return (
    <div className={`card report-metric-card dashboard-summary-card p-4 border rounded-2 h-100 ${className}`}>
      <div className="d-flex gap-3">
        <div className={`icon-shape icon-md text-white rounded-2 ${iconClassName}`}>
          <i className={`ti ${icon} fs-4`}></i>
        </div>
        <div className="min-w-0">
          <h2 className="mb-3 fs-6">{label}</h2>
          <h3 className={`fw-bold mb-0 dashboard-card-value ${valueClassName}`}>
            {value}
          </h3>
          <p className={`mb-0 small ${noteClassName}`}>{note}</p>
        </div>
      </div>
    </div>
  )
}

function ActivityItem({ icon, title, text }) {
  return (
    <div className="activity-item">
      <div className="icon-shape icon-sm bg-primary bg-opacity-10 text-primary rounded-2">
        <i className={`ti ${icon}`}></i>
      </div>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  )
}

function FigureTile({ icon, label, value }) {
  return (
    <div className="figure-tile">
      <div className="icon-shape icon-sm bg-primary bg-opacity-10 text-primary rounded-2">
        <i className={`ti ${icon}`}></i>
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default DashboardPage
