import { useEffect, useState } from 'react'
import axios from 'axios'
import { GeoJSON, MapContainer, Marker, Pane, Popup, TileLayer } from 'react-leaflet'
import '../App.css'

const API_BASE_URL = 'http://127.0.0.1:8000'
const SOUTHERN_LEYTE_POSITION = [10.22, 125.05]

const riskStyles = {
  '100%': {
    color: '#7f1d1d',
    fillColor: '#dc2626',
    fillOpacity: 0.48,
    weight: 2,
  },
  '75%': {
    color: '#b45309',
    fillColor: '#f97316',
    fillOpacity: 0.42,
    weight: 2,
  },
  '50%': {
    color: '#a16207',
    fillColor: '#facc15',
    fillOpacity: 0.36,
    weight: 2,
  },
  '30%': {
    color: '#4d7c0f',
    fillColor: '#84cc16',
    fillOpacity: 0.30,
    weight: 2,
  },
  '15%': {
    color: '#166534',
    fillColor: '#22c55e',
    fillOpacity: 0.24,
    weight: 2,
  },
  High: {
    color: '#991b1b',
    fillColor: '#ef4444',
    fillOpacity: 0.42,
    weight: 2,
  },
  Medium: {
    color: '#b45309',
    fillColor: '#f59e0b',
    fillOpacity: 0.38,
    weight: 2,
  },
  Low: {
    color: '#166534',
    fillColor: '#22c55e',
    fillOpacity: 0.32,
    weight: 2,
  },
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

function getRiskStyle(feature) {
  return riskStyles[feature.properties.risk_level] ?? riskStyles.Low
}

function bindRiskPopup(feature, layer) {
  const { name, risk_level: riskLevel, probability } = feature.properties

  layer.bindPopup(`
    <strong>${name}</strong><br />
    Risk: ${riskLabelByLevel[riskLevel] ?? riskLevel}<br />
    Probability: ${Math.round(probability * 100)}%
  `)
}

function PredictionPage() {
  const [apiStatus, setApiStatus] = useState('checking')
  const [riskZones, setRiskZones] = useState(null)
  const [riskStatus, setRiskStatus] = useState('loading')
  const [predictionStatus, setPredictionStatus] = useState('idle')
  const [livePredictionStatus, setLivePredictionStatus] = useState('idle')
  const [simulationStatus, setSimulationStatus] = useState('idle')
  const [rainfallRate, setRainfallRate] = useState(20)
  const [durationHours, setDurationHours] = useState(6)
  const [saturationFactor, setSaturationFactor] = useState(1)

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
    <main className="map-shell">
      <aside className="status-panel" aria-label="System status">
        <span className={`status-dot status-dot--${apiStatus}`} />
        <div>
          <p className="status-label">FastAPI</p>
          <p className="status-value">{apiStatus}</p>
        </div>
      </aside>

      <aside className="predict-panel" aria-label="Prediction controls">
        <button
          type="button"
          className="predict-button"
          onClick={runPrediction}
          disabled={predictionStatus === 'running'}
        >
          {predictionStatus === 'running' ? 'Predicting...' : 'Run Prediction'}
        </button>
        <p className={`predict-status predict-status--${predictionStatus}`}>
          {predictionStatus}
        </p>

        <button
          type="button"
          className="predict-button live-button"
          onClick={runLivePrediction}
          disabled={livePredictionStatus === 'running'}
        >
          {livePredictionStatus === 'running' ? 'Fetching...' : 'Run Live Prediction'}
        </button>
        <p className={`predict-status predict-status--${livePredictionStatus}`}>
          {livePredictionStatus}
        </p>
      </aside>

      <aside className="simulation-panel" aria-label="Rainfall simulation controls">
        <label className="field-label" htmlFor="rainfall-rate">
          Rainfall mm/hr
        </label>
        <input
          id="rainfall-rate"
          className="field-input"
          type="number"
          min="0"
          max="300"
          step="1"
          value={rainfallRate}
          onChange={(event) => setRainfallRate(event.target.value)}
        />

        <label className="field-label" htmlFor="duration-hours">
          Duration hours
        </label>
        <input
          id="duration-hours"
          className="field-input"
          type="number"
          min="0"
          max="168"
          step="1"
          value={durationHours}
          onChange={(event) => setDurationHours(event.target.value)}
        />

        <label className="field-label" htmlFor="saturation-factor">
          Saturation
        </label>
        <input
          id="saturation-factor"
          className="field-input"
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={saturationFactor}
          onChange={(event) => setSaturationFactor(event.target.value)}
        />

        <button
          type="button"
          className="predict-button simulation-button"
          onClick={runRainfallSimulation}
          disabled={simulationStatus === 'running'}
        >
          {simulationStatus === 'running' ? 'Simulating...' : 'Run Simulation'}
        </button>
        <p className={`predict-status predict-status--${simulationStatus}`}>
          {simulationStatus}
        </p>
      </aside>

      <aside className="legend-panel" aria-label="Risk zone legend">
        <p className="legend-title">Risk Zones</p>
        <p className="legend-status">{riskStatus}</p>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--high" />
          Very High
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--medium" />
          High
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--mid" />
          Moderate
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--low-mid" />
          Slightly Low
        </div>
        <div className="legend-row">
          <span className="legend-swatch legend-swatch--low" />
          Low
        </div>
      </aside>

      <MapContainer
        center={SOUTHERN_LEYTE_POSITION}
        zoom={10}
        className="map-view"
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={SOUTHERN_LEYTE_POSITION}>
          <Popup>Southern Leyte analysis center</Popup>
        </Marker>

        <Pane name="risk-low" style={{ zIndex: 410 }} />
        <Pane name="risk-medium" style={{ zIndex: 420 }} />
        <Pane name="risk-high" style={{ zIndex: 430 }} />
        <Pane name="risk-15" style={{ zIndex: 410 }} />
        <Pane name="risk-30" style={{ zIndex: 420 }} />
        <Pane name="risk-50" style={{ zIndex: 430 }} />
        <Pane name="risk-75" style={{ zIndex: 440 }} />
        <Pane name="risk-100" style={{ zIndex: 450 }} />

        {riskZones && (
          riskZones.features.map((feature) => (
            <GeoJSON
              key={`${feature.properties.id}-${feature.properties.risk_level}`}
              data={feature}
              pane={riskPaneByLevel[feature.properties.risk_level] ?? 'risk-low'}
              style={getRiskStyle}
              onEachFeature={bindRiskPopup}
            />
          ))
        )}
      </MapContainer>
    </main>
  )
}

export default PredictionPage
