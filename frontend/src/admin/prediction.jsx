import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  GeoJSON,
  MapContainer,
  Marker,
  Pane,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'

const API_BASE_URL = 'http://127.0.0.1:8000'
const SOUTHERN_LEYTE_POSITION = [10.22, 125.05]
const SOUTHERN_LEYTE_BOUNDS = [
  [9.78, 124.68],
  [10.66, 125.42],
]

const MUNICIPALITIES = [
  { name: 'Anahawan', position: [10.2775, 125.2627], zoom: 12 },
  { name: 'Bontoc', position: [10.3558, 124.9693], zoom: 12 },
  { name: 'Hinunangan', position: [10.3948, 125.1967], zoom: 12 },
  { name: 'Hinundayan', position: [10.3521, 125.2506], zoom: 12 },
  { name: 'Libagon', position: [10.3005, 125.0534], zoom: 12 },
  { name: 'Liloan', position: [10.1615, 125.1261], zoom: 12 },
  { name: 'Limasawa', position: [9.935, 125.0747], zoom: 12 },
  { name: 'Maasin City', position: [10.1336, 124.8444], zoom: 12 },
  { name: 'Macrohon', position: [10.0794, 124.9431], zoom: 12 },
  { name: 'Malitbog', position: [10.1583, 125.0028], zoom: 12 },
  { name: 'Padre Burgos', position: [10.0369, 125.0194], zoom: 12 },
  { name: 'Pintuyan', position: [9.9446, 125.2498], zoom: 12 },
  { name: 'Saint Bernard', position: [10.2833, 125.1167], zoom: 12 },
  { name: 'San Francisco', position: [10.0629, 125.1605], zoom: 12 },
  { name: 'San Juan', position: [10.2667, 125.1833], zoom: 12 },
  { name: 'San Ricardo', position: [9.9148, 125.2773], zoom: 12 },
  { name: 'Silago', position: [10.5291, 125.1619], zoom: 12 },
  { name: 'Sogod', position: [10.385, 124.9819], zoom: 12 },
  { name: 'Tomas Oppus', position: [10.2506, 124.9838], zoom: 12 },
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

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 1,
})

function getRiskStyle(feature) {
  return riskStyles[feature.properties.risk_level] ?? riskStyles.Low
}

function formatPeso(value) {
  return currencyFormatter.format(value ?? 0)
}

function formatNumber(value) {
  return numberFormatter.format(value ?? 0)
}

function buildLossSummary(riskZones) {
  if (!riskZones?.features?.length) {
    return null
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

function isPointInsideRing(point, ring) {
  const x = point.lng
  const y = point.lat
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isPointInsidePolygon(point, polygon) {
  if (!polygon?.length || !isPointInsideRing(point, polygon[0])) {
    return false
  }

  return !polygon.slice(1).some((hole) => isPointInsideRing(point, hole))
}

function isPointInsideFeature(point, feature) {
  const geometry = feature?.geometry

  if (!geometry) {
    return true
  }

  if (geometry.type === 'Polygon') {
    return isPointInsidePolygon(point, geometry.coordinates)
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => isPointInsidePolygon(point, polygon))
  }

  return true
}

function getFeatureBoundsCenter(feature) {
  const bounds = feature?.properties?.bounds

  if (!bounds) {
    return null
  }

  return {
    lat: (bounds[0][0] + bounds[1][0]) / 2,
    lng: (bounds[0][1] + bounds[1][1]) / 2,
  }
}

function findRiskAtPoint(point, riskZones) {
  if (!point || !riskZones?.features?.length) {
    return null
  }

  return riskZones.features
    .filter((feature) => isPointInsideFeature(point, feature))
    .sort((featureA, featureB) => {
      const probabilityA = featureA.properties.probability ?? 0
      const probabilityB = featureB.properties.probability ?? 0

      return probabilityB - probabilityA
    })[0]
}

function bindRiskPopup(feature, layer, selectedBoundary) {
  const {
    name,
    risk_level: riskLevel,
    probability,
    loss_estimate: lossEstimate,
  } = feature.properties

  const lossDetails = lossEstimate
    ? `
      <hr />
      Area: ${formatNumber(lossEstimate.estimated_area_sq_km)} sq km<br />
      Estimated affected people: ${formatNumber(lossEstimate.estimated_affected_people)}<br />
      Estimated economic loss: ${formatPeso(lossEstimate.estimated_economic_loss_php)}<br />
      Possible casualties: ${formatNumber(lossEstimate.estimated_possible_casualties)}<br />
      Recommendation: ${lossEstimate.recommendation}
    `
    : ''

  const popupContent = `
    <strong>${name}</strong><br />
    Risk: ${riskLabelByLevel[riskLevel] ?? riskLevel}<br />
    Probability: ${Math.round(probability * 100)}%
    ${lossDetails}
  `

  layer.on('click', (event) => {
    if (
      selectedBoundary &&
      event.latlng &&
      !isPointInsideFeature(event.latlng, selectedBoundary)
    ) {
      event.originalEvent?.preventDefault()
      event.originalEvent?.stopPropagation()
      return
    }

    layer.bindPopup(popupContent).openPopup(event.latlng)
  })
}

function MapMunicipalityFocus({ municipality, boundary }) {
  const map = useMap()

  useEffect(() => {
    const bounds = boundary?.properties?.bounds

    if (bounds) {
      map.fitBounds(bounds, {
        animate: true,
        duration: 0.8,
        padding: [34, 34],
      })
      return
    }

    if (municipality.name === 'Southern Leyte') {
      map.fitBounds(SOUTHERN_LEYTE_BOUNDS, {
        animate: true,
        duration: 0.8,
        padding: [18, 18],
      })
      return
    }

    map.flyTo(municipality.position, municipality.zoom, {
      animate: true,
      duration: 0.8,
    })
  }, [boundary, map, municipality])

  return null
}

function MapInteractionMode({ enabled }) {
  const map = useMap()

  useEffect(() => {
    const handlers = [
      map.dragging,
      map.scrollWheelZoom,
      map.doubleClickZoom,
      map.boxZoom,
      map.keyboard,
      map.touchZoom,
    ]

    handlers.forEach((handler) => {
      if (!handler) {
        return
      }

      if (enabled) {
        handler.enable()
      } else {
        handler.disable()
      }
    })
  }, [enabled, map])

  return null
}

function PredictionPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [riskZones, setRiskZones] = useState(null)
  const [riskStatus, setRiskStatus] = useState('loading')
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem('sl-lps-theme') ?? 'light',
  )
  const [predictionStatus, setPredictionStatus] = useState('idle')
  const [livePredictionStatus, setLivePredictionStatus] = useState('idle')
  const [simulationStatus, setSimulationStatus] = useState('idle')
  const [showPredictionLoader, setShowPredictionLoader] = useState(true)
  const [rainfallRate, setRainfallRate] = useState(20)
  const [durationHours, setDurationHours] = useState(6)
  const [saturationFactor, setSaturationFactor] = useState(1)
  const [selectedMunicipalityName, setSelectedMunicipalityName] = useState('Bontoc')
  const [municipalityBoundaries, setMunicipalityBoundaries] = useState(null)
  const [selectedMunicipalityBoundary, setSelectedMunicipalityBoundary] =
    useState(null)
  const [barangayBoundaries, setBarangayBoundaries] = useState(null)
  const [selectedBarangayName, setSelectedBarangayName] = useState('')
  const lossSummary = buildLossSummary(riskZones)
  const selectedMunicipality =
    MUNICIPALITIES.find(
      (municipality) => municipality.name === selectedMunicipalityName,
    ) ?? MUNICIPALITIES[1]
  const markerPosition = selectedMunicipality.position
  const selectedBarangayFeature =
    barangayBoundaries?.features?.find(
      (feature) => feature.properties.name === selectedBarangayName,
    ) ?? null
  const selectedBarangayPoint = getFeatureBoundsCenter(selectedBarangayFeature)
  const selectedBarangayRisk = findRiskAtPoint(selectedBarangayPoint, riskZones)
  const mappedZones = riskZones?.features?.length ?? 0
  const highRiskZones =
    riskZones?.features?.filter((feature) =>
      ['75%', '100%', 'High'].includes(feature.properties.risk_level),
    ).length ?? 0
  const isPreparingPrediction =
    riskStatus === 'loading' ||
    predictionStatus === 'running' ||
    livePredictionStatus === 'running' ||
    simulationStatus === 'running'
  const loaderTitle =
    predictionStatus === 'running'
      ? 'Preparing prediction'
      : livePredictionStatus === 'running'
        ? 'Preparing live prediction'
        : simulationStatus === 'running'
          ? 'Preparing rainfall simulation'
          : 'Loading prediction map'
  const loaderMessage =
    predictionStatus === 'running'
      ? 'Running the model and refreshing risk layers'
      : livePredictionStatus === 'running'
        ? 'Fetching live rainfall data before updating zones'
        : simulationStatus === 'running'
          ? 'Applying rainfall inputs to the risk map'
          : 'Loading risk layers and municipality boundaries'

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    localStorage.setItem('sl-lps-theme', themeMode)
  }, [themeMode])

  useEffect(() => {
    if (isPreparingPrediction) {
      setShowPredictionLoader(true)
      return undefined
    }

    const hideLoader = window.setTimeout(() => {
      setShowPredictionLoader(false)
    }, 850)

    return () => window.clearTimeout(hideLoader)
  }, [isPreparingPrediction])

  function loadRiskZones() {
    setRiskStatus('loading')

    return axios
      .get(`${API_BASE_URL}/risk-zones`)
      .then((response) => {
        setRiskZones(response.data)
        setRiskStatus('loaded')
      })
      .catch(() => setRiskStatus('unavailable'))
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
    axios
      .get(`${API_BASE_URL}/municipality-boundaries`)
      .then((response) => setMunicipalityBoundaries(response.data))
      .catch(() => setMunicipalityBoundaries(null))
  }, [])

  useEffect(() => {
    setSelectedMunicipalityBoundary(null)
    setBarangayBoundaries(null)
    setSelectedBarangayName('')

    axios
      .get(
        `${API_BASE_URL}/municipality-boundary/${encodeURIComponent(
          selectedMunicipalityName,
        )}`,
      )
      .then((response) => {
        if (response.data?.geometry) {
          setSelectedMunicipalityBoundary(response.data)
        }
      })
      .catch(() => setSelectedMunicipalityBoundary(null))

    axios
      .get(
        `${API_BASE_URL}/municipality-boundary/${encodeURIComponent(
          selectedMunicipalityName,
        )}/barangays`,
      )
      .then((response) => setBarangayBoundaries(response.data))
      .catch(() => setBarangayBoundaries(null))
  }, [selectedMunicipalityName])

  function runPrediction() {
    setPredictionStatus('running')

    axios
      .post(`${API_BASE_URL}/predict`)
      .then(() => loadRiskZones())
      .then(() => setPredictionStatus('saved'))
      .catch(() => setPredictionStatus('failed'))
  }

  function runLivePrediction() {
    setLivePredictionStatus('running')

    axios
      .post(`${API_BASE_URL}/predict-live`)
      .then(() => loadRiskZones())
      .then(() => setLivePredictionStatus('saved'))
      .catch(() => setLivePredictionStatus('failed'))
  }

  function runRainfallSimulation() {
    setSimulationStatus('running')

    axios
      .post(`${API_BASE_URL}/simulate-rainfall`, {
        rainfall_mm_per_hr: Number(rainfallRate),
        duration_hours: Number(durationHours),
        saturation_factor: Number(saturationFactor),
      })
      .then(() => loadRiskZones())
      .then(() => setSimulationStatus('saved'))
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
            <a className="nav-link active" href="/admin/prediction">
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
          <div className="fw-semibold">Landslide Prediction</div>
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
                <span className="prediction-kicker">Live monitoring console</span>
                <h1 className="fs-3 mb-1">Risk zone intelligence map</h1>
                <p className="text-secondary mb-0">
                  Operational view for mapped landslide risk, rainfall simulation,
                  and planning-level loss estimates.
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
                label="Mapped Zones"
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
                label="High Risk"
                value={formatNumber(highRiskZones)}
                note="Priority zones"
                noteClassName="text-danger"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <SummaryCard
                className="bg-success bg-opacity-10 border-success border-opacity-25"
                icon="ti-users"
                iconClassName="bg-success"
                label="Affected People"
                value={formatNumber(lossSummary?.people)}
                note="Estimated exposure"
                noteClassName="text-success"
              />
            </div>
            <div className="col-xl-3 col-md-6 col-12">
              <SummaryCard
                className="bg-info bg-opacity-10 border-info border-opacity-25"
                icon="ti-server"
                iconClassName="bg-info"
                label="API Status"
                value={apiStatus}
                note="FastAPI connection"
                noteClassName="text-info"
                valueClassName="text-capitalize"
              />
            </div>
          </div>

          <div className="row g-3">
            <div className="col-12 col-xxl-8">
              <div className="card prediction-map-card">
                <div className="card-header map-card-header bg-transparent px-4 py-3">
                  <div>
                    <h3 className="h5 mb-0">Southern Leyte Risk Map</h3>
                    <small className="text-secondary">Geospatial risk layer</small>
                  </div>
                  <div className="map-header-actions">
                    <div className="municipality-select-wrap">
                      <label className="form-label mb-1" htmlFor="municipality-select">
                        Municipality
                      </label>
                      <select
                        id="municipality-select"
                        className="form-select form-select-sm"
                        value={selectedMunicipalityName}
                        onChange={(event) =>
                          setSelectedMunicipalityName(event.target.value)
                        }
                      >
                        {MUNICIPALITIES.map((municipality) => (
                          <option key={municipality.name} value={municipality.name}>
                            {municipality.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="municipality-select-wrap">
                      <label className="form-label mb-1" htmlFor="barangay-select">
                        Barangay
                      </label>
                      <select
                        id="barangay-select"
                        className="form-select form-select-sm"
                        value={selectedBarangayName}
                        disabled={!barangayBoundaries?.features?.length}
                        onChange={(event) =>
                          setSelectedBarangayName(event.target.value)
                        }
                      >
                        <option value="">Select barangay</option>
                        {barangayBoundaries?.features?.map((barangayFeature) => (
                          <option
                            key={barangayFeature.properties.name}
                            value={barangayFeature.properties.name}
                          >
                            {barangayFeature.properties.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="card-body p-0">
                  <div className="prediction-map-frame">
                    <MapContainer
                      center={SOUTHERN_LEYTE_POSITION}
                      zoom={10}
                      className="map-view"
                      scrollWheelZoom={false}
                      maxBounds={SOUTHERN_LEYTE_BOUNDS}
                      maxBoundsViscosity={1}
                      minZoom={9}
                      dragging={false}
                      touchZoom={false}
                      doubleClickZoom={false}
                      boxZoom={false}
                      keyboard={false}
                    >
                      <MapMunicipalityFocus
                        municipality={selectedMunicipality}
                        boundary={selectedMunicipalityBoundary}
                      />
                      <MapInteractionMode enabled={false} />
                      <TileLayer
                        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
                      />

                      <Pane name="barangay-boundaries" style={{ zIndex: 410 }} />
                      <Pane name="municipality-labels" style={{ zIndex: 455 }} />
                      <Pane name="risk-low" style={{ zIndex: 500 }} />
                      <Pane name="risk-medium" style={{ zIndex: 510 }} />
                      <Pane name="risk-high" style={{ zIndex: 520 }} />
                      <Pane name="risk-15" style={{ zIndex: 500 }} />
                      <Pane name="risk-30" style={{ zIndex: 510 }} />
                      <Pane name="risk-50" style={{ zIndex: 520 }} />
                      <Pane name="risk-75" style={{ zIndex: 530 }} />
                      <Pane name="risk-100" style={{ zIndex: 540 }} />
                      <Pane name="selected-boundary" style={{ zIndex: 560 }} />

                      <Marker position={markerPosition}>
                        <Popup>{selectedMunicipality.name} municipality</Popup>
                      </Marker>

                      {selectedBarangayName && selectedBarangayPoint && (
                        <Popup
                          key={`${selectedBarangayName}-${selectedBarangayRisk?.properties?.id ?? 'none'}`}
                          position={selectedBarangayPoint}
                        >
                          {selectedBarangayRisk ? (
                            <div className="prediction-popup">
                              <strong>{selectedBarangayRisk.properties.name}</strong>
                              <br />
                              Risk:{' '}
                              {riskLabelByLevel[
                                selectedBarangayRisk.properties.risk_level
                              ] ?? selectedBarangayRisk.properties.risk_level}
                              <br />
                              Probability:{' '}
                              {Math.round(
                                selectedBarangayRisk.properties.probability * 100,
                              )}
                              %
                              {selectedBarangayRisk.properties.loss_estimate && (
                                <>
                                  <hr />
                                  Area:{' '}
                                  {formatNumber(
                                    selectedBarangayRisk.properties.loss_estimate
                                      .estimated_area_sq_km,
                                  )}{' '}
                                  sq km
                                  <br />
                                  Estimated affected people:{' '}
                                  {formatNumber(
                                    selectedBarangayRisk.properties.loss_estimate
                                      .estimated_affected_people,
                                  )}
                                  <br />
                                  Estimated economic loss:{' '}
                                  {formatPeso(
                                    selectedBarangayRisk.properties.loss_estimate
                                      .estimated_economic_loss_php,
                                  )}
                                  <br />
                                  Possible casualties:{' '}
                                  {formatNumber(
                                    selectedBarangayRisk.properties.loss_estimate
                                      .estimated_possible_casualties,
                                  )}
                                  <br />
                                  Recommendation:{' '}
                                  {
                                    selectedBarangayRisk.properties.loss_estimate
                                      .recommendation
                                  }
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="prediction-popup">
                              <strong>{selectedBarangayName}</strong>
                              <br />
                              No prediction value found for this barangay.
                            </div>
                          )}
                        </Popup>
                      )}

                      {selectedMunicipalityBoundary && (
                        <GeoJSON
                          key={selectedMunicipalityName}
                          data={selectedMunicipalityBoundary}
                          pane="selected-boundary"
                          interactive={false}
                          style={{
                            className: 'selected-municipality-boundary',
                            color: '#7c3aed',
                            fillColor: '#a855f7',
                            fillOpacity: 0.08,
                            opacity: 0.96,
                            weight: 4,
                          }}
                        />
                      )}

                      {barangayBoundaries?.features?.length > 0 && (
                        <GeoJSON
                          key={`${selectedMunicipalityName}-barangays-${selectedBarangayName}`}
                          data={barangayBoundaries}
                          pane="barangay-boundaries"
                          style={(barangayFeature) => {
                            const isSelected =
                              barangayFeature.properties.name === selectedBarangayName

                            return {
                              className: isSelected
                                ? 'barangay-boundary barangay-boundary--selected'
                                : 'barangay-boundary',
                              color: isSelected ? '#111827' : '#6b7280',
                              fillColor: isSelected ? '#111827' : '#ffffff',
                              fillOpacity: isSelected ? 0.08 : 0,
                              opacity: isSelected ? 1 : 0.82,
                              weight: isSelected ? 3.4 : 1.2,
                            }
                          }}
                          onEachFeature={(barangayFeature, layer) => {
                            const barangayName = barangayFeature.properties.name

                            layer.bindPopup(`
                              <strong>${barangayName}</strong><br />
                              Barangay, ${selectedMunicipalityName}
                            `)

                            layer.on('click', () => {
                              setSelectedBarangayName(barangayName)
                            })

                            if (barangayName === selectedBarangayName) {
                              layer.bindTooltip(barangayName, {
                                className: 'barangay-label',
                                direction: 'center',
                                permanent: true,
                              })
                            }
                          }}
                        />
                      )}

                      {municipalityBoundaries?.features?.length > 0 && (
                        <GeoJSON
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
                              className: 'municipality-label',
                              direction: 'center',
                              permanent: true,
                            })
                          }}
                        />
                      )}

                      {riskZones &&
                        riskZones.features.map((feature) => (
                          <GeoJSON
                            key={`${selectedMunicipalityName}-${feature.properties.id}-${feature.properties.risk_level}`}
                            data={feature}
                            pane={
                              riskPaneByLevel[feature.properties.risk_level] ??
                              'risk-low'
                            }
                            style={getRiskStyle}
                            onEachFeature={(riskFeature, layer) =>
                              bindRiskPopup(
                                riskFeature,
                                layer,
                                selectedMunicipalityBoundary,
                              )
                            }
                          />
                        ))}
                    </MapContainer>
                    {showPredictionLoader && (
                      <div className="prediction-loader" aria-live="polite">
                        <div className="prediction-loader-panel">
                          <span className="prediction-loader-ring"></span>
                          <div>
                            <strong>{loaderTitle}</strong>
                            <span>{loaderMessage}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xxl-4">
              <div className="row g-3">
                <div className="col-12 col-lg-6 col-xxl-12">
                  <PredictionControls
                    predictionStatus={predictionStatus}
                    livePredictionStatus={livePredictionStatus}
                    runPrediction={runPrediction}
                    runLivePrediction={runLivePrediction}
                  />
                </div>

                <div className="col-12 col-lg-6 col-xxl-12">
                  <RainfallControls
                    rainfallRate={rainfallRate}
                    durationHours={durationHours}
                    saturationFactor={saturationFactor}
                    simulationStatus={simulationStatus}
                    setRainfallRate={setRainfallRate}
                    setDurationHours={setDurationHours}
                    setSaturationFactor={setSaturationFactor}
                    runRainfallSimulation={runRainfallSimulation}
                  />
                </div>

                <div className="col-12 col-lg-6 col-xxl-12">
                  <EstimatedLoss lossSummary={lossSummary} />
                </div>

                <div className="col-12 col-lg-6 col-xxl-12">
                  <RiskLegend />
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
                  <span>Prediction Console</span>
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
    <div className={`card p-4 border rounded-2 h-100 ${className}`}>
      <div className="d-flex gap-3">
        <div className={`icon-shape icon-md text-white rounded-2 ${iconClassName}`}>
          <i className={`ti ${icon} fs-4`}></i>
        </div>
        <div>
          <h2 className="mb-3 fs-6">{label}</h2>
          <h3 className={`fw-bold mb-0 ${valueClassName}`}>{value}</h3>
          <p className={`mb-0 small ${noteClassName}`}>{note}</p>
        </div>
      </div>
    </div>
  )
}

function PredictionControls({
  predictionStatus,
  livePredictionStatus,
  runPrediction,
  runLivePrediction,
}) {
  return (
    <div className="card h-100">
      <div className="card-header bg-white px-4 py-3">
        <h4 className="mb-0 h5">Prediction</h4>
      </div>
      <div className="card-body p-4">
        <button
          type="button"
          className="btn btn-primary w-100"
          onClick={runPrediction}
          disabled={predictionStatus === 'running'}
        >
          <i className="ti ti-player-play me-1"></i>
          {predictionStatus === 'running' ? 'Predicting...' : 'Run Prediction'}
        </button>
        <p className={`predict-status predict-status--${predictionStatus}`}>
          Prediction: {predictionStatus}
        </p>

        <button
          type="button"
          className="btn btn-outline-primary w-100 mt-3"
          onClick={runLivePrediction}
          disabled={livePredictionStatus === 'running'}
        >
          <i className="ti ti-broadcast me-1"></i>
          {livePredictionStatus === 'running' ? 'Fetching...' : 'Run Live Prediction'}
        </button>
        <p className={`predict-status predict-status--${livePredictionStatus}`}>
          Live feed: {livePredictionStatus}
        </p>
      </div>
    </div>
  )
}

function RainfallControls({
  rainfallRate,
  durationHours,
  saturationFactor,
  simulationStatus,
  setRainfallRate,
  setDurationHours,
  setSaturationFactor,
  runRainfallSimulation,
}) {
  return (
    <div className="card h-100" id="rainfall">
      <div className="card-header bg-white px-4 py-3">
        <h4 className="mb-0 h5">Rainfall Simulation</h4>
      </div>
      <div className="card-body p-4">
        <label className="form-label" htmlFor="rainfall-rate">
          Rainfall mm/hr
        </label>
        <input
          id="rainfall-rate"
          className="form-control mb-3"
          type="number"
          min="0"
          max="300"
          step="1"
          value={rainfallRate}
          onChange={(event) => setRainfallRate(event.target.value)}
        />

        <label className="form-label" htmlFor="duration-hours">
          Duration hours
        </label>
        <input
          id="duration-hours"
          className="form-control mb-3"
          type="number"
          min="0"
          max="168"
          step="1"
          value={durationHours}
          onChange={(event) => setDurationHours(event.target.value)}
        />

        <label className="form-label" htmlFor="saturation-factor">
          Saturation factor
        </label>
        <input
          id="saturation-factor"
          className="form-control mb-3"
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={saturationFactor}
          onChange={(event) => setSaturationFactor(event.target.value)}
        />

        <button
          type="button"
          className="btn btn-dark w-100"
          onClick={runRainfallSimulation}
          disabled={simulationStatus === 'running'}
        >
          <i className="ti ti-cloud-rain me-1"></i>
          {simulationStatus === 'running' ? 'Simulating...' : 'Run Simulation'}
        </button>
        <p className={`predict-status predict-status--${simulationStatus}`}>
          Simulation: {simulationStatus}
        </p>
      </div>
    </div>
  )
}

function EstimatedLoss({ lossSummary }) {
  return (
    <div className="card h-100">
      <div className="card-header bg-white px-4 py-3">
        <h4 className="mb-0 h5">Estimated Loss</h4>
      </div>
      <div className="card-body p-4">
        <div className="loss-metric">
          <span>Economic</span>
          <strong>{formatPeso(lossSummary?.economicLoss)}</strong>
        </div>
        <div className="loss-metric">
          <span>Affected People</span>
          <strong>{formatNumber(lossSummary?.people)}</strong>
        </div>
        <div className="loss-metric">
          <span>Possible Casualties</span>
          <strong>{formatNumber(lossSummary?.casualties)}</strong>
        </div>
        <div className="loss-metric">
          <span>Mapped Area</span>
          <strong>{formatNumber(lossSummary?.area)} sq km</strong>
        </div>
      </div>
    </div>
  )
}

function RiskLegend() {
  return (
    <div className="card h-100">
      <div className="card-header bg-white px-4 py-3">
        <h4 className="mb-0 h5">Risk Zones</h4>
      </div>
      <div className="card-body p-4">
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--high"></span>
          Very High
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--medium"></span>
          High
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--mid"></span>
          Moderate
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--low-mid"></span>
          Slightly Low
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--low"></span>
          Low
        </div>
      </div>
    </div>
  )
}

export default PredictionPage
