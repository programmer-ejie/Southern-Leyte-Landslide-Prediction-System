import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  GeoJSON,
  ImageOverlay,
  MapContainer,
  Pane,
  TileLayer,
  useMap,
} from 'react-leaflet'
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
  [10.622240066000074, 125.35],
]

const SIMULATION_STEPS = [0.2, 0.4, 0.6, 0.8, 1]
const SIMULATION_PRECOMPUTE_ORDER = [4, 0, 1, 2, 3]
const SIMULATION_RESET_STEP = -1
const SIMULATION_STEP_INTERVAL_MS = 900
const SIMULATION_LOGS_PER_PAGE = 5
const MAX_SIMULATION_POLYGON_EDGE_DEGREES = 0.12
const numberFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 1,
})

const currencyFormatter = new Intl.NumberFormat('en-PH', {
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
  return `PHP ${currencyFormatter.format(value ?? 0)}`
}

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

function getRiskStyle(feature) {
  return riskStyles[feature.properties.risk_level] ?? riskStyles.Low
}

function getSimulationRiskStyle(feature, stepPercent) {
  const baseStyle = getRiskStyle(feature)
  const intensity = Math.max(Number(stepPercent) || 0, 20) / 100

  return {
    ...baseStyle,
    fillOpacity: Math.min(
      0.78,
      baseStyle.fillOpacity * (0.55 + intensity * 0.95),
    ),
    opacity: Math.min(1, 0.48 + intensity * 0.52),
    weight: baseStyle.weight + (intensity >= 0.8 ? 0.8 : 0),
  }
}

function sanitizeSimulationRiskZones(riskZoneData) {
  if (!riskZoneData?.features?.length) {
    return riskZoneData
  }

  return {
    ...riskZoneData,
    features: riskZoneData.features
      .map((feature) => {
        const geometry = sanitizeSimulationGeometry(feature.geometry)

        if (!geometry) {
          return null
        }

        return {
          ...feature,
          geometry,
        }
      })
      .filter(Boolean),
  }
}

function sanitizeSimulationGeometry(geometry) {
  if (!geometry) {
    return null
  }

  if (geometry.type === 'Polygon') {
    return polygonHasLongEdge(geometry.coordinates)
      ? null
      : geometry
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates.filter(
      (polygon) => !polygonHasLongEdge(polygon),
    )

    if (!polygons.length) {
      return null
    }

    return {
      ...geometry,
      coordinates: polygons,
    }
  }

  return geometry
}

function polygonHasLongEdge(polygonCoordinates) {
  const exteriorRing = polygonCoordinates?.[0]

  if (!Array.isArray(exteriorRing) || exteriorRing.length < 2) {
    return true
  }

  return exteriorRing.some((point, index) => {
    const nextPoint = exteriorRing[index + 1]

    if (!nextPoint) {
      return false
    }

    return coordinateDistance(point, nextPoint) > MAX_SIMULATION_POLYGON_EDGE_DEGREES
  })
}

function coordinateDistance(pointA, pointB) {
  if (!Array.isArray(pointA) || !Array.isArray(pointB)) {
    return Number.POSITIVE_INFINITY
  }

  return Math.hypot(
    Number(pointA[0]) - Number(pointB[0]),
    Number(pointA[1]) - Number(pointB[1]),
  )
}

function SouthernLeyteMapFocus({ boundary }) {
  const map = useMap()

  useEffect(() => {
    const bounds = boundary?.properties?.bounds ?? BASELINE_RISK_IMAGE_BOUNDS

    map.invalidateSize()
    map.fitBounds(bounds, {
      animate: false,
      padding: [4, 4],
    })
    map.dragging.disable()
    map.scrollWheelZoom.disable()
    map.doubleClickZoom.disable()
    map.boxZoom.disable()
    map.keyboard.disable()
    map.touchZoom.disable()
  }, [boundary, map])

  return null
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

function getDamageHotspot(riskZones) {
  return [...(riskZones?.features ?? [])].sort((featureA, featureB) => {
    const lossA = featureA.properties.loss_estimate?.estimated_economic_loss_php ?? 0
    const lossB = featureB.properties.loss_estimate?.estimated_economic_loss_php ?? 0

    return lossB - lossA
  })[0]
}

function simulationLogFromApi(log) {
  return {
    id: String(log.id),
    timestamp: log.timestamp ?? new Date(log.created_at).toLocaleString('en-PH'),
    createdAt: log.created_at,
    startedAt: log.started_at,
    endedBy: log.ended_by,
    rainfallRate: log.rainfall_rate,
    durationHours: log.duration_hours,
    saturationFactor: log.saturation_factor,
    stepPercent: log.step_percent,
    affectedPeople: log.affected_people,
    possibleCasualties: log.possible_casualties,
    economicLoss: log.economic_loss,
    mappedArea: log.mapped_area,
    hotspot: log.hotspot,
    riskLevel: log.risk_level,
  }
}

function RainfallScenariosPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const apiHasConnectedRef = useRef(false)
  const [riskStatus, setRiskStatus] = useState('loading')
  const [provinceBoundaryStatus, setProvinceBoundaryStatus] = useState('loading')
  const [municipalityStatus, setMunicipalityStatus] = useState('loading')
  const [barangayStatus, setBarangayStatus] = useState('loading')
  const [simulationLogStatus, setSimulationLogStatus] = useState('loading')
  const [simulationStatus, setSimulationStatus] = useState('idle')
  const [themeMode, setThemeMode] = useState(
    getStoredTheme,
  )

  function markApiConnected() {
    apiHasConnectedRef.current = true
    setApiStatus('connected')
  }
  const [riskZones, setRiskZones] = useState(null)
  const [rainfallRate, setRainfallRate] = useState(120)
  const [durationHours, setDurationHours] = useState(6)
  const [saturationFactor, setSaturationFactor] = useState(1)
  const [isSimulationPlaying, setIsSimulationPlaying] = useState(false)
  const [isSimulationPrecomputing, setIsSimulationPrecomputing] = useState(false)
  const [simulationPrecomputeProgress, setSimulationPrecomputeProgress] = useState(0)
  const [simulationPrecomputeLabel, setSimulationPrecomputeLabel] = useState(
    'Preparing simulation',
  )
  const [simulationStep, setSimulationStep] = useState(SIMULATION_RESET_STEP)
  const [simulationStartedAt, setSimulationStartedAt] = useState(null)
  const [simulationLogs, setSimulationLogs] = useState([])
  const [simulationLogPage, setSimulationLogPage] = useState(1)
  const [showSimulationMapLoader, setShowSimulationMapLoader] = useState(true)
  const [simulationMapLoaderLabel, setSimulationMapLoaderLabel] = useState(
    'Loading simulation map',
  )
  const [provinceBoundary, setProvinceBoundary] = useState(null)
  const [municipalityBoundaries, setMunicipalityBoundaries] = useState(null)
  const [barangayBoundaries, setBarangayBoundaries] = useState(null)
  const simulationRunRef = useRef(0)
  const latestSimulationSnapshotRef = useRef(null)
  const simulationStepSnapshotsRef = useRef([])

  const lossSummary = useMemo(() => buildLossSummary(riskZones), [riskZones])
  const damageHotspot = useMemo(() => getDamageHotspot(riskZones), [riskZones])
  const sortedSimulationLogs = useMemo(
    () =>
      [...simulationLogs].sort((logA, logB) => {
        const createdA = Date.parse(logA.createdAt ?? logA.timestamp ?? '') || 0
        const createdB = Date.parse(logB.createdAt ?? logB.timestamp ?? '') || 0

        if (createdA !== createdB) {
          return createdB - createdA
        }

        return Number(logB.id ?? 0) - Number(logA.id ?? 0)
      }),
    [simulationLogs],
  )
  const totalSimulationLogPages = Math.max(
    1,
    Math.ceil(sortedSimulationLogs.length / SIMULATION_LOGS_PER_PAGE),
  )
  const pagedSimulationLogs = sortedSimulationLogs.slice(
    (simulationLogPage - 1) * SIMULATION_LOGS_PER_PAGE,
    simulationLogPage * SIMULATION_LOGS_PER_PAGE,
  )
  const highRiskZones =
    riskZones?.features?.filter((feature) =>
      ['75%', '100%', 'High'].includes(feature.properties.risk_level),
    ).length ?? 0
  const hasBaselineRiskLayer = riskZones?.features?.some((feature) =>
    feature.properties.name?.startsWith('Baseline Hazard'),
  )
  const baselineOverlayVersion =
    riskZones?.features
      ?.filter((feature) => feature.properties.name?.startsWith('Baseline Hazard'))
      .map((feature) => feature.properties.id)
      .join('-') || 'baseline'
  const riskLayerVersion =
    riskZones?.features?.map((feature) => feature.properties.id).join('-') || 'empty'
  const displayedBaselineOverlayVersion = hasBaselineRiskLayer
    ? baselineOverlayVersion
    : `simulation-underlay-${riskLayerVersion}`
  const activeStepPercent =
    simulationStep === SIMULATION_RESET_STEP
      ? 0
      : Math.round((SIMULATION_STEPS[simulationStep] ?? SIMULATION_STEPS[0]) * 100)
  const intensityIndex = Math.min(
    100,
    Math.round(
      (Number(rainfallRate) / 300) * 55 +
        (Number(durationHours) / 168) * 25 +
      (Number(saturationFactor) / 5) * 20,
    ),
  )
  const simulationLoaderChecklist = [
    {
      label: 'Risk layer',
      detail: 'Current Southern Leyte hazard map',
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
      status: provinceBoundaryStatus,
    },
    {
      label: 'Municipalities',
      detail: 'Municipality labels',
      status: municipalityStatus,
    },
    {
      label: 'Barangay boundaries',
      detail: 'Barangay subdivision lines',
      status: barangayStatus,
    },
    {
      label: 'Simulation logs',
      detail: 'Stopped rainfall scenario records',
      status: simulationLogStatus,
    },
  ]

  function loadInitialRiskZones() {
    setRiskStatus('loading')

    return axios
      .get(`${API_BASE_URL}/risk-zones`)
      .then((response) => {
        markApiConnected()
        setRiskZones(sanitizeSimulationRiskZones(response.data))
        setRiskStatus('loaded')
        return response.data
      })
      .catch(() => {
        setRiskStatus('unavailable')
        return null
      })
  }

  function loadProvinceBoundary() {
    setProvinceBoundaryStatus('loading')

    return axios
      .get(`${API_BASE_URL}/province-boundary`)
      .then((response) => {
        markApiConnected()
        setProvinceBoundary(response.data)
        setProvinceBoundaryStatus('ready')
      })
      .catch(() => {
        setProvinceBoundary(null)
        setProvinceBoundaryStatus('error')
      })
  }

  function loadMunicipalityBoundaries() {
    setMunicipalityStatus('loading')

    return axios
      .get(`${API_BASE_URL}/municipality-boundaries`)
      .then((response) => {
        markApiConnected()
        setMunicipalityBoundaries(response.data)
        setMunicipalityStatus('ready')
      })
      .catch(() => {
        setMunicipalityBoundaries(null)
        setMunicipalityStatus('error')
      })
  }

  function loadBarangayBoundaries() {
    setBarangayStatus('loading')

    return axios
      .get(`${API_BASE_URL}/barangay-boundaries`)
      .then((response) => {
        markApiConnected()
        setBarangayBoundaries(response.data)
        setBarangayStatus('ready')
      })
      .catch(() => {
        setBarangayBoundaries(null)
        setBarangayStatus('error')
      })
  }

  function loadSimulationLogs() {
    setSimulationLogStatus('loading')

    return axios
      .get(`${API_BASE_URL}/rainfall-simulation-logs`)
      .then((response) => {
        markApiConnected()
        setSimulationLogs((response.data?.logs ?? []).map(simulationLogFromApi))
        setSimulationLogStatus('ready')
      })
      .catch(() => setSimulationLogStatus('error'))
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

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    setShowSimulationMapLoader(true)
    setSimulationMapLoaderLabel('Loading simulation map')

    loadInitialRiskZones().then(() =>
      Promise.all([
        loadProvinceBoundary(),
        loadMunicipalityBoundaries(),
        loadBarangayBoundaries(),
        loadSimulationLogs(),
      ]),
    ).finally(() => setShowSimulationMapLoader(false))
  }, [])

  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    loadSavedTheme(setThemeMode)
  }, [])

  useEffect(() => {
    setSimulationLogPage((page) => Math.min(page, totalSimulationLogPages))
  }, [totalSimulationLogPages])

  function saveSimulationLog(reason = 'Stopped') {
    const snapshot = latestSimulationSnapshotRef.current
    const loggedRiskZones = snapshot?.riskZones ?? riskZones
    const summary = buildLossSummary(loggedRiskZones)
    const hotspot = getDamageHotspot(loggedRiskZones)

    const logEntry = {
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleString('en-PH'),
      createdAt: new Date().toISOString(),
      startedAt: simulationStartedAt,
      endedBy: reason,
      rainfallRate: snapshot?.rainfallRate ?? Number(rainfallRate),
      durationHours: snapshot?.durationHours ?? Number(durationHours),
      saturationFactor: snapshot?.saturationFactor ?? Number(saturationFactor),
      stepPercent: snapshot?.stepPercent ?? activeStepPercent,
      affectedPeople: summary.people,
      possibleCasualties: summary.casualties,
      economicLoss: summary.economicLoss,
      mappedArea: summary.area,
      hotspot: hotspot?.properties?.name ?? 'No hotspot',
      riskLevel:
        riskLabelByLevel[hotspot?.properties?.risk_level] ??
        hotspot?.properties?.risk_level ??
        'Unavailable',
    }

    setSimulationLogs((logs) => [logEntry, ...logs])

    axios
      .post(`${API_BASE_URL}/rainfall-simulation-logs`, {
        timestamp: logEntry.timestamp,
        started_at: logEntry.startedAt,
        ended_by: logEntry.endedBy,
        rainfall_rate: logEntry.rainfallRate,
        duration_hours: logEntry.durationHours,
        saturation_factor: logEntry.saturationFactor,
        step_percent: logEntry.stepPercent,
        affected_people: logEntry.affectedPeople,
        possible_casualties: logEntry.possibleCasualties,
        economic_loss: logEntry.economicLoss,
        mapped_area: logEntry.mappedArea,
        hotspot: logEntry.hotspot,
        risk_level: logEntry.riskLevel,
      })
      .then(() => loadSimulationLogs())
      .catch(() => undefined)
  }

  function buildSimulationStepSnapshot(stepIndex, riskZoneData) {
    const stepMultiplier = SIMULATION_STEPS[stepIndex] ?? SIMULATION_STEPS[0]

    return {
      riskZones: riskZoneData,
      rainfallRate: Number(rainfallRate) * stepMultiplier,
      durationHours: Number(durationHours) * stepMultiplier,
      saturationFactor: Math.min(
        Math.max((Number(saturationFactor) || 0) * stepMultiplier, 0),
        5,
      ),
      stepPercent: Math.round(stepMultiplier * 100),
    }
  }

  function getSimulationStepPayload(stepIndex) {
    const stepMultiplier = SIMULATION_STEPS[stepIndex] ?? SIMULATION_STEPS[0]

    return {
      rainfall_mm_per_hr: Number(rainfallRate),
      duration_hours: Number(durationHours),
      saturation_factor: Math.min(Math.max(Number(saturationFactor) || 0, 0), 5),
      scenario_intensity: stepMultiplier,
    }
  }

  function applyCachedSimulationStep(stepIndex, runId = simulationRunRef.current) {
    const snapshot = simulationStepSnapshotsRef.current[stepIndex]

    if (!snapshot || runId !== simulationRunRef.current) {
      return
    }

    setRiskZones(snapshot.riskZones)
    setRiskStatus('preview')
    setSimulationStep(stepIndex)
    latestSimulationSnapshotRef.current = snapshot
  }

  async function precomputeSimulationSteps(runId = simulationRunRef.current) {
    const snapshots = []

    setIsSimulationPrecomputing(true)
    setSimulationStatus('precomputing')
    setSimulationPrecomputeProgress(0)
    setSimulationPrecomputeLabel('Preparing simulation maps')

    try {
      for (let orderIndex = 0; orderIndex < SIMULATION_PRECOMPUTE_ORDER.length; orderIndex += 1) {
        const stepIndex = SIMULATION_PRECOMPUTE_ORDER[orderIndex]
        const stepPercent = Math.round(SIMULATION_STEPS[stepIndex] * 100)
        setSimulationPrecomputeLabel(`Precomputing ${stepPercent}% map`)

        const response = await axios.post(
          `${API_BASE_URL}/simulate-rainfall-preview`,
          getSimulationStepPayload(stepIndex),
        )

        if (runId !== simulationRunRef.current) {
          return null
        }

        const snapshot = buildSimulationStepSnapshot(
          stepIndex,
          sanitizeSimulationRiskZones(response.data?.risk_zones ?? null),
        )
        snapshots[stepIndex] = snapshot
        setSimulationPrecomputeProgress(
          Math.round(((orderIndex + 1) / SIMULATION_PRECOMPUTE_ORDER.length) * 100),
        )
      }

      simulationStepSnapshotsRef.current = snapshots
      return snapshots
    } catch {
      if (runId === simulationRunRef.current) {
        setSimulationStatus('failed')
      }

      return null
    } finally {
      if (runId === simulationRunRef.current) {
        setIsSimulationPrecomputing(false)
      }
    }
  }

  function toggleRainfallSimulation() {
    if (isSimulationPlaying) {
      simulationRunRef.current += 1
      setIsSimulationPlaying(false)
      setSimulationStatus('stopped')
      saveSimulationLog('Stopped')
      return
    }

    simulationRunRef.current += 1
    const runId = simulationRunRef.current
    setSimulationStartedAt(new Date().toLocaleString('en-PH'))
    setSimulationStep(SIMULATION_RESET_STEP)
    latestSimulationSnapshotRef.current = null
    simulationStepSnapshotsRef.current = []
    precomputeSimulationSteps(runId).then((snapshots) => {
      if (!snapshots || runId !== simulationRunRef.current) {
        return
      }

      setIsSimulationPlaying(true)
      applyCachedSimulationStep(0, runId)
      setSimulationStatus('playing')
    })
  }

  function resetSimulationMapLayer(
    runId = simulationRunRef.current,
    nextStatus = 'idle',
    showLoader = false,
  ) {
    setSimulationStep(SIMULATION_RESET_STEP)
    setSimulationStatus('resetting')

    if (showLoader) {
      setShowSimulationMapLoader(true)
      setSimulationMapLoaderLabel('Resetting map')
    }

    return loadInitialRiskZones()
      .then(() => loadProvinceBoundary())
      .then(() => {
        if (runId === simulationRunRef.current) {
          setSimulationStatus(nextStatus)
        }
      })
      .catch(() => {
        if (runId === simulationRunRef.current) {
          setSimulationStatus('failed')
        }
      })
      .finally(() => {
        if (showLoader && runId === simulationRunRef.current) {
          setShowSimulationMapLoader(false)
        }
      })
  }

  function resetSimulationMap() {
    simulationRunRef.current += 1
    setIsSimulationPlaying(false)
    setIsSimulationPrecomputing(false)
    setSimulationPrecomputeProgress(0)
    setSimulationStartedAt(null)
    latestSimulationSnapshotRef.current = null
    simulationStepSnapshotsRef.current = []
    resetSimulationMapLayer(simulationRunRef.current, 'idle', true)
  }

  useEffect(() => {
    if (!isSimulationPlaying) {
      return undefined
    }

    if (simulationStatus !== 'playing') {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      if (simulationStep === SIMULATION_STEPS.length - 1) {
        applyCachedSimulationStep(0, simulationRunRef.current)
        return
      }

      const nextStep =
        simulationStep === SIMULATION_RESET_STEP ? 0 : simulationStep + 1
      applyCachedSimulationStep(nextStep, simulationRunRef.current)
    }, SIMULATION_STEP_INTERVAL_MS)

    return () => window.clearTimeout(timeoutId)
  }, [
    isSimulationPlaying,
    rainfallRate,
    durationHours,
    saturationFactor,
    simulationStatus,
    simulationStep,
  ])

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
          <div className="fw-semibold">Rainfall Simulation</div>
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
                <span className="prediction-kicker">Scenario map and impact logs</span>
                <h1 className="fs-3 mb-1">Rainfall Simulation</h1>
                <p className="text-secondary mb-0">
                  Run rainfall scenarios, review generated risk maps, and identify
                  where estimated damage is highest.
                </p>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3 scenario-metrics-row">
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

          <div className="row g-3 mb-3 simulation-workspace-row">
            <div className="col-12 col-lg-8">
              <div className="card prediction-map-card">
                <div className="card-header map-card-header bg-transparent px-4 py-3">
                  <div className="map-header-title">
                    <h4 className="mb-0 h5">Rainfall Simulation Map</h4>
                    <p className="text-secondary mb-0">
                      Locked Southern Leyte view with animated rainfall scenario output.
                    </p>
                  </div>
                  <span className={`predict-status predict-status--${riskStatus}`}>
                    Step {activeStepPercent}% / {simulationStatus}
                  </span>
                </div>
                <div className="card-body p-0">
                  <div className="prediction-map-frame prediction-map-frame--simulation">
                    <MapContainer
                      center={SOUTHERN_LEYTE_POSITION}
                      zoom={10}
                      zoomSnap={0.1}
                      zoomDelta={0.5}
                      className="map-view"
                      zoomControl={false}
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
                      <SouthernLeyteMapFocus boundary={provinceBoundary} />
                      <TileLayer
                        attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
                      />
                      <Pane name="baseline-risk-image" style={{ zIndex: 490 }} />
                      <Pane name="risk-low" style={{ zIndex: 500 }} />
                      <Pane name="risk-medium" style={{ zIndex: 510 }} />
                      <Pane name="risk-high" style={{ zIndex: 520 }} />
                      <Pane name="risk-15" style={{ zIndex: 500 }} />
                      <Pane name="risk-30" style={{ zIndex: 510 }} />
                      <Pane name="risk-50" style={{ zIndex: 520 }} />
                      <Pane name="risk-75" style={{ zIndex: 530 }} />
                      <Pane name="risk-100" style={{ zIndex: 540 }} />
                      <Pane name="simulation-barangays" style={{ zIndex: 565 }} />
                      <Pane name="province-boundary" style={{ zIndex: 575 }} />
                      <Pane name="simulation-municipalities" style={{ zIndex: 585 }} />

                      <ImageOverlay
                        bounds={BASELINE_RISK_IMAGE_BOUNDS}
                        pane="baseline-risk-image"
                        url={`${API_BASE_URL}/baseline-risk-overlay.png?v=${displayedBaselineOverlayVersion}`}
                        opacity={
                          simulationStep === SIMULATION_RESET_STEP
                            ? 1
                            : Math.max(0.46, 1 - activeStepPercent / 180)
                        }
                      />

                      {riskZones &&
                        riskZones.features.map((feature) =>
                          hasBaselineRiskLayer &&
                          feature.properties.name?.startsWith('Baseline Hazard') ? null : (
                            <GeoJSON
                              key={`simulation-step-${activeStepPercent}-${feature.properties.id}-${feature.properties.risk_level}`}
                              data={feature}
                              pane={
                                riskPaneByLevel[feature.properties.risk_level] ??
                                'risk-low'
                              }
                              style={(riskFeature) =>
                                getSimulationRiskStyle(riskFeature, activeStepPercent)
                              }
                            />
                          ),
                        )}

                      {barangayBoundaries?.features?.length > 0 && (
                        <GeoJSON
                          key={`simulation-barangays-${barangayBoundaries.features.length}`}
                          data={barangayBoundaries}
                          pane="simulation-barangays"
                          interactive={false}
                          style={{
                            className: 'simulation-barangay-boundary',
                            color: '#374151',
                            fillOpacity: 0,
                            opacity: 0.95,
                            weight: 1.2,
                          }}
                        />
                      )}

                      {provinceBoundary?.geometry && (
                        <GeoJSON
                          key="simulation-province-boundary"
                          data={provinceBoundary}
                          pane="province-boundary"
                          interactive={false}
                          style={{
                            className: 'province-boundary',
                            color: '#111827',
                            fillOpacity: 0,
                            opacity: 1,
                            weight: 4,
                          }}
                        />
                      )}

                      {municipalityBoundaries?.features?.length > 0 && (
                        <GeoJSON
                          key="simulation-municipality-labels"
                          data={municipalityBoundaries}
                          pane="simulation-municipalities"
                          interactive={false}
                          style={{
                            color: 'transparent',
                            fillOpacity: 0,
                            opacity: 0,
                            weight: 0,
                          }}
                          onEachFeature={(municipalityFeature, layer) => {
                            layer.bindTooltip(municipalityFeature.properties.name, {
                              className: 'simulation-municipality-label',
                              direction: 'center',
                              permanent: true,
                            })
                          }}
                        />
                      )}
                    </MapContainer>
                    {showSimulationMapLoader && (
                      <div className="simulation-map-loader">
                        <span className="prediction-loader-ring"></span>
                        <div className="prediction-loader-content">
                          <strong>{simulationMapLoaderLabel}</strong>
                          <small>
                            Preparing the Southern Leyte risk layer and boundaries.
                          </small>
                          <ul className="prediction-loader-checklist">
                            {simulationLoaderChecklist.map((item) => (
                              <li
                                key={item.label}
                                className={`prediction-loader-check prediction-loader-check--${item.status}`}
                              >
                                <i
                                  className={`ti ${
                                    item.status === 'ready'
                                      ? 'ti-check'
                                      : item.status === 'error'
                                        ? 'ti-alert-triangle'
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
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-4">
              <div className="card h-100 simulation-builder-card">
                <div className="card-header bg-white px-4 py-3">
                  <div>
                    <h4 className="mb-0 h5">Scenario Builder</h4>
                    <p className="text-secondary mb-0 small">
                      Press run to play the scenario loop. Press stop to save the
                      event into logs.
                    </p>
                  </div>
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
                    max="5"
                    step="0.1"
                    value={saturationFactor}
                    onChange={(event) => setSaturationFactor(event.target.value)}
                  />

                  <button
                    type="button"
                    className={`btn w-100 ${
                      isSimulationPlaying ? 'btn-danger' : 'btn-primary'
                    }`}
                    onClick={toggleRainfallSimulation}
                    disabled={isSimulationPrecomputing}
                  >
                    <i
                      className={`ti ${
                        isSimulationPrecomputing
                          ? 'ti-loader-2'
                          : isSimulationPlaying
                            ? 'ti-player-stop'
                            : 'ti-player-play'
                      } me-1`}
                    ></i>
                    {isSimulationPrecomputing
                      ? 'Preparing Simulation...'
                      : isSimulationPlaying
                        ? 'Stop Simulation'
                        : 'Run Simulation'}
                  </button>
                  {isSimulationPrecomputing && (
                    <div className="simulation-precompute-panel">
                      <div className="simulation-precompute-heading">
                        <span>{simulationPrecomputeLabel}</span>
                        <strong>{simulationPrecomputeProgress}%</strong>
                      </div>
                      <div className="simulation-precompute-track">
                        <div
                          className="simulation-precompute-fill"
                          style={{ width: `${simulationPrecomputeProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                  <p className={`predict-status predict-status--${simulationStatus}`}>
                    Simulation: {simulationStatus}
                  </p>
                  <div className="simulation-step-strip">
                    {SIMULATION_STEPS.map((step, index) => (
                      <span
                        key={step}
                        className={
                          index === simulationStep && isSimulationPlaying
                            ? 'active'
                            : ''
                        }
                      >
                        {Math.round(step * 100)}%
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger w-100 mt-4"
                    onClick={resetSimulationMap}
                    disabled={simulationStatus === 'resetting'}
                  >
                    <i className="ti ti-rotate-2 me-1"></i>
                    {simulationStatus === 'resetting' ? 'Resetting Map...' : 'Reset Map'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-6">
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

            <div className="col-12 col-xl-6">
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
            <div className="col-12">
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
                        <th className="simulation-log-number-cell">Possible casualties</th>
                        <th className="simulation-log-number-cell">Economic loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedSimulationLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{log.timestamp}</td>
                          <td>
                            {log.rainfallRate}mm / {log.durationHours}h / sat{' '}
                            {log.saturationFactor}
                          </td>
                          <td>
                            {log.hotspot}
                            <span className="d-block text-secondary small">
                              {log.riskLevel} / stopped at {log.stepPercent}%
                            </span>
                          </td>
                          <td className="simulation-log-number-cell">
                            {formatNumber(log.possibleCasualties)}
                          </td>
                          <td className="simulation-log-number-cell">
                            {formatPeso(log.economicLoss)}
                          </td>
                        </tr>
                      ))}
                      {sortedSimulationLogs.length === 0 && (
                        <tr>
                          <td colSpan="5" className="text-secondary text-center">
                            No simulations run in this session yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="alert-pagination px-4 py-3">
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    disabled={simulationLogPage === 1}
                    onClick={() =>
                      setSimulationLogPage((page) => Math.max(1, page - 1))
                    }
                  >
                    <i className="ti ti-chevron-left"></i>
                    Previous
                  </button>
                  <span>
                    Page {simulationLogPage} of {totalSimulationLogPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    disabled={simulationLogPage === totalSimulationLogPages}
                    onClick={() =>
                      setSimulationLogPage((page) =>
                        Math.min(totalSimulationLogPages, page + 1),
                      )
                    }
                  >
                    Next
                    <i className="ti ti-chevron-right"></i>
                  </button>
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
                  <span>Rainfall Simulation</span>
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
      className={`card scenario-metric-card border rounded-2 h-100 bg-${tone} bg-opacity-10 border-${tone} border-opacity-25`}
    >
      <div className="scenario-metric-inner">
        <div className={`icon-shape scenario-metric-icon bg-${tone} text-white rounded-2`}>
          <i className={`ti ${icon} fs-4`}></i>
        </div>
        <div className="scenario-metric-content">
          <h2>{label}</h2>
          <strong className="scenario-metric-value">{value}</strong>
          <p className={`text-${tone} text-capitalize`}>{note}</p>
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
