import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  GeoJSON,
  ImageOverlay,
  MapContainer,
  Marker,
  Pane,
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
const BASELINE_RISK_IMAGE_BOUNDS = [
  [9.88, 124.62],
  [10.55, 125.35],
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
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 1,
})

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

function formatPeso(value) {
  return `PHP ${currencyFormatter.format(value ?? 0)}`
}

function formatNumber(value) {
  return numberFormatter.format(value ?? 0)
}

function formatPercent(value) {
  return `${formatNumber((value ?? 0) * 100)}%`
}

function formatRiskPercent(value) {
  return `${formatNumber(value ?? 0)}%`
}

function formatRunTimestamp(value) {
  if (!value) {
    return 'Current session'
  }

  return new Date(value).toLocaleString('en-PH')
}

function getActiveLayerInfo(riskZones, latestRunMetadata) {
  const firstName = riskZones?.features?.[0]?.properties?.name ?? ''

  if (firstName.startsWith('Baseline Hazard')) {
    return {
      label: 'Baseline Hazard',
      source: 'Curated 5-level Southern Leyte hazard mask',
      detail: 'Static planning layer restored from local baseline data.',
      tone: 'baseline',
    }
  }

  if (firstName.startsWith('Live Rainfall Prediction')) {
    const liveWeather = latestRunMetadata?.scenario?.live_weather

    return {
      label: 'Live Rainfall Prediction',
      source: `${liveWeather?.source ?? 'Open-Meteo Forecast API'} + baseline hazard + local tensor`,
      detail: liveWeather?.fetched_at_utc
        ? `Fetched ${formatRunTimestamp(liveWeather.fetched_at_utc)}; live rainfall adjusts the baseline hazard while terrain, soil, land cover, and geology remain from the local tensor.`
        : 'Uses newly updated rainfall forecast with the baseline hazard and local Southern Leyte tensor before refreshing risk zones.',
      tone: 'live',
    }
  }

  if (firstName.startsWith('Rainfall Simulation')) {
    return {
      label: 'Rainfall Simulation',
      source: 'User-defined rainfall scenario',
      detail: 'Scenario layer generated from rainfall, duration, and saturation inputs.',
      tone: 'scenario',
    }
  }

  if (firstName.startsWith('Attention U-Net')) {
    return {
      label: 'Attention U-Net Prediction',
      source: 'Local model checkpoint: attention_unet.pth',
      detail: 'Model inference using Southern Leyte processed tensor inputs.',
      tone: 'model',
    }
  }

  return {
    label: 'Risk Layer',
    source: 'Loaded risk zone database',
    detail: 'Current mapped risk zones from backend storage.',
    tone: 'default',
  }
}

function RiskBreakdownList({ breakdown }) {
  if (breakdown === null) {
    return <span>Loading barangay risk share...</span>
  }

  if (!breakdown?.length) {
    return <span>Risk breakdown: No barangay overlap data</span>
  }

  return (
    <span className="prediction-popup-breakdown">
      <span className="prediction-popup-breakdown-title">Barangay risk share</span>
      {breakdown.map((item) => (
        <span
          className="prediction-popup-breakdown-row"
          key={item.risk_level}
        >
          <span>
            <span
              className={`prediction-popup-swatch prediction-popup-swatch--${item.risk_level.replace('%', '')}`}
            ></span>
            {item.label}
          </span>
          <strong>{formatRiskPercent(item.percent)}</strong>
        </span>
      ))}
    </span>
  )
}

function BarangayInfoPanel({
  activeLayerInfo,
  selectedBarangayRiskBreakdown,
  selectedBarangayFeature,
  selectedBarangayName,
  selectedBarangayRisk,
  selectedMunicipalityName,
}) {
  const lossEstimate = selectedBarangayRisk?.properties?.loss_estimate

  if (!selectedBarangayName) {
    return (
      <aside className="prediction-info-panel prediction-info-panel--empty">
        <div className="prediction-info-empty-copy">
          <ActiveLayerBadge activeLayerInfo={activeLayerInfo} />
          <span className="prediction-info-kicker">Barangay details</span>
          <h4>Select a barangay</h4>
          <p>
            Choose a barangay from the dropdown or click a colored area on the map
            to view population, risk share, and exposure estimates.
          </p>
        </div>
        <RiskLegend variant="panel" />
      </aside>
    )
  }

  return (
    <aside className="prediction-info-panel">
      <ActiveLayerBadge activeLayerInfo={activeLayerInfo} />
      <span className="prediction-info-kicker">Barangay details</span>
      <div className="prediction-info-heading">
        <div>
          <h4>{selectedBarangayName}</h4>
          <p>Barangay, {selectedMunicipalityName}</p>
        </div>
        <span className="prediction-info-risk">
          {selectedBarangayRisk
            ? (riskLabelByLevel[selectedBarangayRisk.properties.risk_level] ??
              selectedBarangayRisk.properties.risk_level)
            : 'No risk'}
        </span>
      </div>

      <div className="prediction-info-metrics">
        <div>
          <span>Population</span>
          <strong>
            {selectedBarangayFeature?.properties?.population
              ? formatNumber(selectedBarangayFeature.properties.population)
              : 'No record'}
          </strong>
          {selectedBarangayFeature?.properties?.population_year && (
            <small>{selectedBarangayFeature.properties.population_year}</small>
          )}
        </div>
        <div>
          <span>Probability</span>
          <strong>
            {selectedBarangayRisk
              ? `${Math.round(selectedBarangayRisk.properties.probability * 100)}%`
              : '-'}
          </strong>
        </div>
      </div>

      <div className="prediction-info-section">
        <RiskBreakdownList breakdown={selectedBarangayRiskBreakdown} />
      </div>

      <div className="prediction-info-disclaimer">
        <i className="ti ti-info-circle"></i>
        Planning-support estimate only. Validate with LGU field reports and ground
        observations before operational decisions.
      </div>

      {lossEstimate ? (
        <>
          <div className="prediction-info-section">
            <span className="prediction-info-section-title">Exposure estimate</span>
            <dl className="prediction-info-list">
              <div>
                <dt>Mapped risk area</dt>
                <dd>{formatNumber(lossEstimate.estimated_area_sq_km)} sq km</dd>
              </div>
              <div>
                <dt>Exposed area share</dt>
                <dd>{formatPercent(lossEstimate.exposure_area_fraction)}</dd>
              </div>
              <div>
                <dt>Affected people</dt>
                <dd>{formatNumber(lossEstimate.estimated_affected_people)}</dd>
              </div>
              <div>
                <dt>Exposed asset value</dt>
                <dd>{formatPeso(lossEstimate.exposed_asset_value_php)}</dd>
              </div>
              <div>
                <dt>Economic loss</dt>
                <dd>{formatPeso(lossEstimate.estimated_economic_loss_php)}</dd>
              </div>
              <div>
                <dt>Damage ratio</dt>
                <dd>{formatPercent(lossEstimate.damage_ratio)}</dd>
              </div>
              <div>
                <dt>Possible casualties</dt>
                <dd>{formatNumber(lossEstimate.estimated_possible_casualties)}</dd>
              </div>
            </dl>
          </div>

          <div className="prediction-info-section">
            <span className="prediction-info-section-title">Recommendation</span>
            <p className="prediction-info-recommendation">
              {lossEstimate.recommendation}
            </p>
          </div>
        </>
      ) : (
        <p className="prediction-info-recommendation">
          No prediction value found for this barangay.
        </p>
      )}
    </aside>
  )
}

function ActiveLayerBadge({ activeLayerInfo }) {
  return (
    <div className={`active-layer-badge active-layer-badge--${activeLayerInfo.tone}`}>
      <span>{activeLayerInfo.label}</span>
      <strong>{activeLayerInfo.source}</strong>
    </div>
  )
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

function riskFromBreakdown(breakdown) {
  if (!breakdown?.length) {
    return null
  }

  const dominantRisk = [...breakdown].sort((a, b) => b.percent - a.percent)[0]

  if (!dominantRisk || dominantRisk.percent <= 0) {
    return null
  }

  return {
    properties: {
      risk_level: dominantRisk.risk_level,
      probability: Number(dominantRisk.risk_level.replace('%', '')) / 100,
      loss_estimate: null,
    },
  }
}

function selectMunicipalityFromMap(
  point,
  municipalityBoundaries,
  selectedMunicipalityName,
  setSelectedMunicipalityName,
  setPendingBarangayClick,
  setSelectedBarangayName,
) {
  const clickedMunicipality =
    municipalityBoundaries?.features?.find((municipalityFeature) =>
      isPointInsideFeature(point, municipalityFeature),
    ) ?? null
  const clickedMunicipalityName = clickedMunicipality?.properties?.name

  if (!clickedMunicipalityName) {
    return null
  }

  setPendingBarangayClick({
    municipalityName: clickedMunicipalityName,
    point: {
      lat: point.lat,
      lng: point.lng,
    },
  })

  if (clickedMunicipalityName !== selectedMunicipalityName) {
    setSelectedMunicipalityName(clickedMunicipalityName)
    setSelectedBarangayName('')
  }

  return clickedMunicipalityName
}

function bindRiskPopup(
  feature,
  layer,
  barangayBoundaries,
  municipalityBoundaries,
  selectedMunicipalityName,
  setSelectedMunicipalityName,
  setPendingBarangayClick,
  setSelectedBarangayName,
) {
  layer.on('click', (event) => {
    if (!event.latlng) {
      event.originalEvent?.preventDefault()
      event.originalEvent?.stopPropagation()
      return
    }

    selectMunicipalityFromMap(
      event.latlng,
      municipalityBoundaries,
      selectedMunicipalityName,
      setSelectedMunicipalityName,
      setPendingBarangayClick,
      setSelectedBarangayName,
    )

    const clickedBarangay =
      barangayBoundaries?.features?.find((barangayFeature) =>
        isPointInsideFeature(event.latlng, barangayFeature),
      ) ?? null
    const clickedBarangayName = clickedBarangay?.properties?.name

    if (clickedBarangayName) {
      setSelectedBarangayName(clickedBarangayName)
      setPendingBarangayClick(null)
      return
    }
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
  }, [boundary, map, municipality.name, municipality.position, municipality.zoom])

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
  const [municipalityStatus, setMunicipalityStatus] = useState('loading')
  const [selectedBoundaryStatus, setSelectedBoundaryStatus] = useState('loading')
  const [baselineOverlayStatus, setBaselineOverlayStatus] = useState('idle')
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem('sl-lps-theme') ?? 'light',
  )
  const [predictionStatus, setPredictionStatus] = useState('idle')
  const [livePredictionStatus, setLivePredictionStatus] = useState('idle')
  const [showPredictionLoader, setShowPredictionLoader] = useState(true)
  const [selectedMunicipalityName, setSelectedMunicipalityName] = useState('Bontoc')
  const [municipalityBoundaries, setMunicipalityBoundaries] = useState(null)
  const [provinceBoundary, setProvinceBoundary] = useState(null)
  const [latestRunMetadata, setLatestRunMetadata] = useState(null)
  const [selectedMunicipalityBoundary, setSelectedMunicipalityBoundary] =
    useState(null)
  const [barangayBoundaries, setBarangayBoundaries] = useState(null)
  const [selectedBarangayName, setSelectedBarangayName] = useState('')
  const [pendingBarangayClick, setPendingBarangayClick] = useState(null)
  const [selectedBarangayRiskBreakdown, setSelectedBarangayRiskBreakdown] =
    useState([])
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
  const pointSelectedBarangayRisk = findRiskAtPoint(selectedBarangayPoint, riskZones)
  const selectedBarangayRisk =
    pointSelectedBarangayRisk ?? riskFromBreakdown(selectedBarangayRiskBreakdown)
  const mappedZones = riskZones?.features?.length ?? 0
  const hasBaselineRiskLayer = riskZones?.features?.some((feature) =>
    feature.properties.name?.startsWith('Baseline Hazard'),
  )
  const baselineOverlayVersion =
    riskZones?.features
      ?.filter((feature) => feature.properties.name?.startsWith('Baseline Hazard'))
      .map((feature) => feature.properties.id)
      .join('-') || 'baseline'
  const highRiskZones =
    riskZones?.features?.filter((feature) =>
      ['75%', '100%', 'High'].includes(feature.properties.risk_level),
    ).length ?? 0
  const activeLayerInfo = getActiveLayerInfo(riskZones, latestRunMetadata)
  const shouldShowBaselineOverlay =
    hasBaselineRiskLayer ||
    activeLayerInfo.tone === 'model' ||
    activeLayerInfo.tone === 'live' ||
    activeLayerInfo.tone === 'scenario'
  const riskLayerVersion =
    riskZones?.features?.map((feature) => feature.properties.id).join('-') || 'empty'
  const displayedBaselineOverlayVersion = hasBaselineRiskLayer
    ? baselineOverlayVersion
    : `baseline-underlay-${riskLayerVersion}`
  const isPreparingPrediction =
    riskStatus === 'loading' ||
    municipalityStatus === 'loading' ||
    selectedBoundaryStatus === 'loading' ||
    baselineOverlayStatus === 'loading' ||
    predictionStatus === 'running' ||
    livePredictionStatus === 'running'
  const loaderTitle =
    predictionStatus === 'running'
      ? 'Preparing prediction'
      : livePredictionStatus === 'running'
        ? 'Preparing live prediction'
        : 'Loading prediction map'
  const loaderMessage =
    predictionStatus === 'running'
      ? 'Using the local Attention U-Net model and Southern Leyte baseline tensors to refresh risk zones'
      : livePredictionStatus === 'running'
        ? 'Fetching newly updated rainfall data from the Open-Meteo Forecast API before updating risk zones'
        : 'Loading risk layers and municipality boundaries'
  const loaderChecklist = [
    {
      label:
        livePredictionStatus === 'running'
          ? 'Rainfall source'
          : predictionStatus === 'running'
            ? 'Prediction engine'
            : 'Prediction engine',
      detail:
        livePredictionStatus === 'running'
          ? 'Open-Meteo + baseline hazard + tensor'
          : 'Attention U-Net and local tensors',
      status:
        livePredictionStatus === 'running' || predictionStatus === 'running'
          ? 'loading'
          : livePredictionStatus === 'failed' || predictionStatus === 'failed'
            ? 'error'
            : 'ready',
    },
    {
      label: 'Risk zones',
      detail: 'Current mapped hazard layer',
      status:
        riskStatus === 'loading'
          ? 'loading'
          : riskStatus === 'unavailable'
            ? 'error'
            : 'ready',
    },
    {
      label: 'Province boundary',
      detail: 'Southern Leyte clipping mask',
      status: provinceBoundary?.geometry
        ? 'ready'
        : riskStatus === 'unavailable'
          ? 'error'
          : 'loading',
    },
    {
      label: 'Municipalities',
      detail: 'Dropdown and map focus data',
      status:
        municipalityStatus === 'loading'
          ? 'loading'
          : municipalityStatus === 'unavailable'
            ? 'error'
            : 'ready',
    },
    {
      label: 'Barangay boundaries',
      detail: selectedMunicipalityName,
      status:
        selectedBoundaryStatus === 'loading'
          ? 'loading'
          : selectedBoundaryStatus === 'unavailable'
            ? 'error'
            : 'ready',
    },
    ...(hasBaselineRiskLayer
      ? [
          {
            label: 'Baseline overlay',
            detail: 'Raster risk image',
            status:
              baselineOverlayStatus === 'loading'
                ? 'loading'
                : baselineOverlayStatus === 'unavailable'
                  ? 'error'
                  : 'ready',
          },
        ]
      : []),
  ]

  function waitForMapPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.setTimeout(resolve, 250)
        })
      })
    })
  }

  function scrollToPredictionMap() {
    window.setTimeout(() => {
      document
        .getElementById('prediction-risk-map')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

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
        return loadProvinceBoundary().then(() => {
          setRiskStatus('loaded')
          return response.data
        })
      })
      .catch((error) => {
        setRiskStatus('unavailable')
        throw error
      })
  }

  function loadProvinceBoundary() {
    return axios
      .get(`${API_BASE_URL}/province-boundary`)
      .then((response) => setProvinceBoundary(response.data))
      .catch(() => setProvinceBoundary(null))
  }

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/health`)
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('offline'))
  }, [])

  useEffect(() => {
    loadRiskZones().catch(() => undefined)
  }, [])

  useEffect(() => {
    setMunicipalityStatus('loading')

    axios
      .get(`${API_BASE_URL}/municipality-boundaries`)
      .then((response) => {
        setMunicipalityBoundaries(response.data)
        setMunicipalityStatus('loaded')
      })
      .catch(() => {
        setMunicipalityBoundaries(null)
        setMunicipalityStatus('unavailable')
      })
  }, [])

  useEffect(() => {
    let isCurrentRequest = true

    setSelectedBoundaryStatus('loading')
    setSelectedMunicipalityBoundary(null)
    setBarangayBoundaries(null)
    setSelectedBarangayName('')
    setSelectedBarangayRiskBreakdown([])

    const municipalityRequest = axios
      .get(
        `${API_BASE_URL}/municipality-boundary/${encodeURIComponent(
          selectedMunicipalityName,
        )}`,
      )
      .then((response) => {
        if (isCurrentRequest && response.data?.geometry) {
          setSelectedMunicipalityBoundary(response.data)
        }
      })
      .catch(() => {
        if (isCurrentRequest) {
          setSelectedMunicipalityBoundary(null)
        }
      })

    const barangaysRequest = axios
      .get(
        `${API_BASE_URL}/municipality-boundary/${encodeURIComponent(
          selectedMunicipalityName,
        )}/barangays`,
      )
      .then((response) => {
        if (isCurrentRequest) {
          setBarangayBoundaries(response.data)
        }
      })
      .catch(() => {
        if (isCurrentRequest) {
          setBarangayBoundaries(null)
        }
      })

    Promise.allSettled([municipalityRequest, barangaysRequest]).then(() => {
      if (isCurrentRequest) {
        setSelectedBoundaryStatus('loaded')
      }
    })

    return () => {
      isCurrentRequest = false
    }
  }, [selectedMunicipalityName])

  useEffect(() => {
    if (!selectedMunicipalityName || !selectedBarangayName) {
      setSelectedBarangayRiskBreakdown([])
      return
    }

    setSelectedBarangayRiskBreakdown(null)

    axios
      .get(
        `${API_BASE_URL}/municipality-boundary/${encodeURIComponent(
          selectedMunicipalityName,
        )}/barangay/${encodeURIComponent(selectedBarangayName)}/risk-breakdown`,
      )
      .then((response) =>
        setSelectedBarangayRiskBreakdown(response.data?.risk_breakdown ?? []),
      )
      .catch(() => setSelectedBarangayRiskBreakdown([]))
  }, [selectedBarangayName, selectedMunicipalityName])

  useEffect(() => {
    if (shouldShowBaselineOverlay) {
      setBaselineOverlayStatus('loading')
      return
    }

    setBaselineOverlayStatus('idle')
  }, [displayedBaselineOverlayVersion, shouldShowBaselineOverlay])

  useEffect(() => {
    if (
      !pendingBarangayClick ||
      pendingBarangayClick.municipalityName !== selectedMunicipalityName ||
      !barangayBoundaries?.features?.length
    ) {
      return
    }

    const clickedBarangay =
      barangayBoundaries.features.find((barangayFeature) =>
        isPointInsideFeature(pendingBarangayClick.point, barangayFeature),
      ) ?? null

    if (clickedBarangay?.properties?.name) {
      setSelectedBarangayName(clickedBarangay.properties.name)
    }

    setPendingBarangayClick(null)
  }, [barangayBoundaries, pendingBarangayClick, selectedMunicipalityName])

  function runPrediction() {
    setPredictionStatus('running')
    scrollToPredictionMap()

    axios
      .post(`${API_BASE_URL}/predict`)
      .then((response) =>
        setLatestRunMetadata({
          ...response.data,
          layerType: 'model',
          ranAt: new Date().toISOString(),
        }),
      )
      .then(() => loadRiskZones())
      .then(() => waitForMapPaint())
      .then(() => setPredictionStatus('saved'))
      .catch(() => setPredictionStatus('failed'))
  }

  function resetBaselineMap() {
    setPredictionStatus('running')
    scrollToPredictionMap()

    axios
      .post(`${API_BASE_URL}/restore-baseline-risk`)
      .then((response) =>
        setLatestRunMetadata({
          ...response.data,
          layerType: 'baseline',
          ranAt: new Date().toISOString(),
        }),
      )
      .then(() => loadRiskZones())
      .then(() => waitForMapPaint())
      .then(() => {
        setSelectedBarangayRiskBreakdown([])
        setPredictionStatus('baseline')
      })
      .catch(() => setPredictionStatus('failed'))
  }

  function runLivePrediction() {
    setLivePredictionStatus('running')
    scrollToPredictionMap()

    axios
      .post(`${API_BASE_URL}/predict-live`)
      .then((response) =>
        setLatestRunMetadata({
          ...response.data,
          layerType: 'live',
          ranAt: new Date().toISOString(),
        }),
      )
      .then(() => loadRiskZones())
      .then(() => waitForMapPaint())
      .then(() => setLivePredictionStatus('saved'))
      .catch(() => setLivePredictionStatus('failed'))
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
            <div className="col-12">
              <div className="card prediction-map-card" id="prediction-risk-map">
                <div className="card-header map-card-header bg-transparent px-4 py-3">
                  <div className="map-header-title">
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
                        onChange={(event) => {
                          setPendingBarangayClick(null)
                          setSelectedMunicipalityName(event.target.value)
                        }}
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
                  <div className="prediction-map-layout">
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
                        key={selectedMunicipalityName}
                        municipality={selectedMunicipality}
                        boundary={selectedMunicipalityBoundary}
                      />
                      <MapInteractionMode enabled={false} />
                      <TileLayer
                        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
                      />

                      <Pane name="barangay-boundaries" style={{ zIndex: 410 }} />
                      <Pane name="municipality-clicks" style={{ zIndex: 430 }} />
                      <Pane name="municipality-labels" style={{ zIndex: 455 }} />
                      <Pane name="baseline-risk-image" style={{ zIndex: 490 }} />
                      <Pane name="barangay-boundary-lines" style={{ zIndex: 555 }} />
                      <Pane name="risk-low" style={{ zIndex: 500 }} />
                      <Pane name="risk-medium" style={{ zIndex: 510 }} />
                      <Pane name="risk-high" style={{ zIndex: 520 }} />
                      <Pane name="risk-15" style={{ zIndex: 500 }} />
                      <Pane name="risk-30" style={{ zIndex: 510 }} />
                      <Pane name="risk-50" style={{ zIndex: 520 }} />
                      <Pane name="risk-75" style={{ zIndex: 530 }} />
                      <Pane name="risk-100" style={{ zIndex: 540 }} />
                      <Pane name="province-boundary" style={{ zIndex: 560 }} />

                      <Marker position={markerPosition}></Marker>

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
                          key="southern-leyte-province-boundary"
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
                          key={`${selectedMunicipalityName}-barangays-${selectedBarangayName}`}
                          data={barangayBoundaries}
                          pane="barangay-boundary-lines"
                          style={(barangayFeature) => {
                            const isSelected =
                              barangayFeature.properties.name === selectedBarangayName

                            return {
                              className: isSelected
                                ? 'barangay-boundary barangay-boundary--selected'
                                : 'barangay-boundary',
                              color: isSelected ? '#2563eb' : '#000000',
                              fillColor: isSelected ? '#2563eb' : '#ffffff',
                              fillOpacity: isSelected ? 0.03 : 0,
                              opacity: isSelected ? 1 : 0.95,
                              weight: isSelected ? 1.7 : 1.15,
                            }
                          }}
                          onEachFeature={(barangayFeature, layer) => {
                            const barangayName = barangayFeature.properties.name
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
                          key="municipality-click-layer"
                          data={municipalityBoundaries}
                          pane="municipality-clicks"
                          style={{
                            color: 'transparent',
                            fillColor: '#ffffff',
                            fillOpacity: 0.001,
                            opacity: 0,
                            weight: 0,
                          }}
                          onEachFeature={(municipalityFeature, layer) => {
                            layer.on('click', (event) => {
                              selectMunicipalityFromMap(
                                event.latlng,
                                municipalityBoundaries,
                                selectedMunicipalityName,
                                setSelectedMunicipalityName,
                                setPendingBarangayClick,
                                setSelectedBarangayName,
                              )
                            })
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
                          hasBaselineRiskLayer &&
                          feature.properties.name?.startsWith('Baseline Hazard') ? null : (
                            <GeoJSON
                              key={`${selectedMunicipalityName}-${barangayBoundaries?.features?.length ?? 0}-${feature.properties.id}-${feature.properties.risk_level}`}
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
                                  barangayBoundaries,
                                  municipalityBoundaries,
                                  selectedMunicipalityName,
                                  setSelectedMunicipalityName,
                                  setPendingBarangayClick,
                                  setSelectedBarangayName,
                                )
                              }
                            />
                          )
                        ))}
                    </MapContainer>
                    {showPredictionLoader && (
                      <div className="prediction-loader" aria-live="polite">
                        <div className="prediction-loader-panel">
                          <span className="prediction-loader-ring"></span>
                          <div className="prediction-loader-content">
                            <strong>{loaderTitle}</strong>
                            <span>{loaderMessage}</span>
                            <ul className="prediction-loader-checklist">
                              {loaderChecklist.map((item) => (
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
                    <BarangayInfoPanel
                      activeLayerInfo={activeLayerInfo}
                      selectedBarangayRiskBreakdown={selectedBarangayRiskBreakdown}
                      selectedBarangayFeature={selectedBarangayFeature}
                      selectedBarangayName={selectedBarangayName}
                      selectedBarangayRisk={selectedBarangayRisk}
                      selectedMunicipalityName={selectedMunicipalityName}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xxl-4">
              <div className="row g-3">
                <div className="col-12 col-lg-6 col-xxl-12">
                  <PredictionControls
                    activeLayerInfo={activeLayerInfo}
                    latestRunMetadata={latestRunMetadata}
                    predictionStatus={predictionStatus}
                    livePredictionStatus={livePredictionStatus}
                    resetBaselineMap={resetBaselineMap}
                    runPrediction={runPrediction}
                    runLivePrediction={runLivePrediction}
                  />
                </div>

                <div className="col-12 col-lg-6 col-xxl-12">
                  <EstimatedLoss
                    activeLayerInfo={activeLayerInfo}
                    lossSummary={lossSummary}
                  />
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
  activeLayerInfo,
  latestRunMetadata,
  predictionStatus,
  livePredictionStatus,
  resetBaselineMap,
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
        <button
          type="button"
          className="btn btn-danger w-100 mt-3"
          onClick={resetBaselineMap}
          disabled={predictionStatus === 'running'}
        >
          <i className="ti ti-refresh me-1"></i>
          Reset Map
        </button>
        <p className={`predict-status predict-status--${predictionStatus}`}>
          Prediction: {predictionStatus}
        </p>

        <button
          type="button"
          className="btn btn-primary w-100 mt-3"
          onClick={runLivePrediction}
          disabled={livePredictionStatus === 'running'}
        >
          <i className="ti ti-broadcast me-1"></i>
          {livePredictionStatus === 'running' ? 'Fetching...' : 'Run Live Prediction'}
        </button>
        <p className="prediction-source-note">
          Gets newly updated rainfall data from the Open-Meteo Forecast API, applies
          it over the baseline hazard and local Southern Leyte tensor, then updates
          the live risk zones.
        </p>
        <p className={`predict-status predict-status--${livePredictionStatus}`}>
          Live feed: {livePredictionStatus}
        </p>

        <div className="prediction-provenance">
          <span className="prediction-info-section-title">Current Source</span>
          <strong>{activeLayerInfo.label}</strong>
          <span>{activeLayerInfo.source}</span>
          <small>{activeLayerInfo.detail}</small>
          {latestRunMetadata?.model && (
            <small>
              Model: {latestRunMetadata.model}
              {latestRunMetadata.checkpoint
                ? ` / ${latestRunMetadata.checkpoint}`
                : ''}
            </small>
          )}
          {latestRunMetadata?.inference_check?.sample_image && (
            <small>
              Input: {latestRunMetadata.inference_check.sample_image.includes('southern_leyte_demo_001.h5')
                ? 'local Southern Leyte tensor'
                : latestRunMetadata.inference_check.sample_image}
            </small>
          )}
          {latestRunMetadata?.ranAt && (
            <small>Updated: {formatRunTimestamp(latestRunMetadata.ranAt)}</small>
          )}
        </div>
      </div>
    </div>
  )
}

function EstimatedLoss({ activeLayerInfo, lossSummary }) {
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
        <div className="loss-context">
          <span className="prediction-info-section-title">Estimate Context</span>
          <p>
            Provincial planning estimate based on the current{' '}
            <strong>{activeLayerInfo.label}</strong> layer.
          </p>
          <dl>
            <div>
              <dt>Exposure inputs</dt>
              <dd>Barangay population, OSM assets, and mapped risk area</dd>
            </div>
            <div>
              <dt>Use level</dt>
              <dd>Decision support, validation required before response action</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}

function RiskLegend({ variant = 'card' }) {
  const content = (
    <div className="legend-list">
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
  )

  if (variant === 'panel') {
    return (
      <div className="prediction-info-legend">
        <span className="prediction-info-section-title">Risk Zones</span>
        {content}
      </div>
    )
  }

  return (
    <div className="card h-100">
      <div className="card-header bg-white px-4 py-3">
        <h4 className="mb-0 h5">Risk Zones</h4>
      </div>
      <div className="card-body p-4">{content}</div>
    </div>
  )
}

export default PredictionPage
