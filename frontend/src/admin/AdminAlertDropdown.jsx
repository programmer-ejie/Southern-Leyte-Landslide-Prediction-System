import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { API_BASE_URL } from './theme-settings'

const LATEST_ALERT_CACHE_KEY = 'sl-lps-latest-alert-zone'

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

function getCachedLatestAlert() {
  try {
    return JSON.parse(localStorage.getItem(LATEST_ALERT_CACHE_KEY) || 'null')
  } catch (_) {
    return null
  }
}

function cacheLatestAlert(alert) {
  if (!alert) return

  localStorage.setItem(LATEST_ALERT_CACHE_KEY, JSON.stringify(alert))
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

function getAlertSourceFromName(name) {
  const alertName = String(name ?? '')

  if (alertName.startsWith('Live Rainfall Prediction')) {
    return {
      label: 'Open-Meteo Forecast API',
      detail: 'Live rainfall prediction output',
    }
  }

  if (alertName.startsWith('Rainfall Simulation')) {
    return {
      label: 'Simulated rainfall scenario',
      detail: 'Saved rainfall simulation output',
    }
  }

  if (alertName.startsWith('Baseline Hazard')) {
    return {
      label: 'Baseline hazard layer',
      detail: 'Curated Southern Leyte hazard layer',
    }
  }

  return {
    label: 'Saved model prediction',
    detail: 'Latest saved prediction output',
  }
}

function buildAlerts(riskZones) {
  return [...(riskZones?.features ?? [])]
    .map((feature) => {
      const source = getAlertSourceFromName(feature.properties.name)

      return {
        id: feature.properties.id,
        name: feature.properties.name,
        riskLevel:
          riskLabelByLevel[feature.properties.risk_level] ??
          feature.properties.risk_level,
        probability: feature.properties.probability ?? 0,
        severity: getSeverity(feature),
        priority: getPriorityScore(feature),
        sourceLabel: source.label,
        sourceDetail: source.detail,
      }
    })
    .sort((alertA, alertB) => alertB.priority - alertA.priority)
}

function buildAlertsFromPayload(alertPayload) {
  return [...(alertPayload?.alerts ?? [])]
    .map((alert) => {
      const source = getAlertSourceFromName(alert.name)

      return {
        id: alert.id,
        name: alert.name,
        riskLevel: alert.riskLevel,
        probability: alert.probability ?? 0,
        severity: alert.severity,
        priority: alert.priority ?? 0,
        sourceLabel: source.label,
        sourceDetail: alert.sourceDetail ?? source.detail,
      }
    })
    .sort((alertA, alertB) => alertB.priority - alertA.priority)
}

function AdminAlertDropdown({ alertsPayload, riskZones }) {
  const dropdownRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [fallbackRiskZones, setFallbackRiskZones] = useState(null)
  const [fallbackAlertsPayload, setFallbackAlertsPayload] = useState(null)
  const [cachedLatestAlert, setCachedLatestAlert] = useState(() => getCachedLatestAlert())

  useEffect(() => {
    if (alertsPayload || riskZones) {
      return undefined
    }

    let isMounted = true

    axios
      .get(`${API_BASE_URL}/risk-zones`)
      .then((response) => {
        if (isMounted) {
          setFallbackRiskZones(response.data)
        }
      })
      .catch(() => {
        axios
          .get(`${API_BASE_URL}/alerts`)
          .then((response) => {
            if (isMounted) {
              setFallbackAlertsPayload(response.data)
            }
          })
          .catch(() => {
            if (isMounted) {
              setFallbackAlertsPayload({ alerts: [] })
            }
          })
      })

    return () => {
      isMounted = false
    }
  }, [alertsPayload, riskZones])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [])

  const alerts = useMemo(() => {
    if (alertsPayload) {
      return buildAlertsFromPayload(alertsPayload)
    }

    if (riskZones || fallbackRiskZones) {
      return buildAlerts(riskZones ?? fallbackRiskZones)
    }

    return buildAlertsFromPayload(fallbackAlertsPayload)
  }, [alertsPayload, fallbackAlertsPayload, fallbackRiskZones, riskZones])
  const latestAlert = alerts[0] ?? cachedLatestAlert ?? null
  const previewAlerts = latestAlert ? [latestAlert] : []

  useEffect(() => {
    const nextLatestAlert = alerts[0]

    if (!nextLatestAlert) {
      return
    }

    cacheLatestAlert(nextLatestAlert)
    setCachedLatestAlert(nextLatestAlert)
  }, [alerts])

  return (
    <li className="position-relative" ref={dropdownRef}>
      <button
        type="button"
        className="position-relative btn-icon btn-sm btn-light btn rounded-circle"
        onClick={() => setIsOpen((currentState) => !currentState)}
        aria-expanded={isOpen}
        aria-label="Alert zones"
      >
        <i className="ti ti-map-pin-exclamation fs-5"></i>
        <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger mt-2 ms-n2">
          {latestAlert ? 1 : 0}
        </span>
      </button>

      {isOpen && (
        <div className="alerts-dropdown shadow-lg">
          <div className="alerts-dropdown-header">
            <div>
              <strong>Latest Alert Zone</strong>
              <span>
                {latestAlert
                  ? `Source: ${latestAlert.sourceLabel}`
                  : 'No latest prediction output'}
              </span>
            </div>
            <span>{latestAlert ? 1 : 0}</span>
          </div>

          <div className="alerts-dropdown-list">
            {previewAlerts.map((alert) => (
              <button
                type="button"
                className="alerts-dropdown-item"
                key={alert.id}
              >
                <span className={`alert-dot alert-dot--${alert.severity}`}></span>
                <span>
                  <strong>{alert.name}</strong>
                  <small>
                    {alert.severity} - {Math.round(alert.probability * 100)}%
                    probability - {alert.sourceDetail}
                  </small>
                </span>
                <em>{alert.priority}</em>
              </button>
            ))}

            {previewAlerts.length === 0 && (
              <p className="alerts-dropdown-empty mb-0">No alerts available.</p>
            )}
          </div>

          <a className="alerts-dropdown-action" href="/admin/alerts">
            See all alert zones
            <i className="ti ti-arrow-right"></i>
          </a>
        </div>
      )}
    </li>
  )
}

export default AdminAlertDropdown
