import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const API_BASE_URL = 'http://127.0.0.1:8000'

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

function buildAlerts(riskZones) {
  return [...(riskZones?.features ?? [])]
    .map((feature) => ({
      id: feature.properties.id,
      name: feature.properties.name,
      riskLevel:
        riskLabelByLevel[feature.properties.risk_level] ??
        feature.properties.risk_level,
      probability: feature.properties.probability ?? 0,
      severity: getSeverity(feature),
      priority: getPriorityScore(feature),
    }))
    .sort((alertA, alertB) => alertB.priority - alertA.priority)
}

function AdminAlertDropdown({ riskZones }) {
  const dropdownRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [fallbackRiskZones, setFallbackRiskZones] = useState(null)

  useEffect(() => {
    if (riskZones) {
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
        if (isMounted) {
          setFallbackRiskZones({ features: [] })
        }
      })

    return () => {
      isMounted = false
    }
  }, [riskZones])

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

  const alerts = useMemo(
    () => buildAlerts(riskZones ?? fallbackRiskZones),
    [fallbackRiskZones, riskZones],
  )
  const previewAlerts = alerts.slice(0, 5)

  return (
    <li className="position-relative" ref={dropdownRef}>
      <button
        type="button"
        className="position-relative btn-icon btn-sm btn-light btn rounded-circle"
        onClick={() => setIsOpen((currentState) => !currentState)}
        aria-expanded={isOpen}
        aria-label="Alerts"
      >
        <i className="ti ti-bell fs-5"></i>
        <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger mt-2 ms-n2">
          {alerts.length}
        </span>
      </button>

      {isOpen && (
        <div className="alerts-dropdown shadow-lg">
          <div className="alerts-dropdown-header">
            <div>
              <strong>Latest Alerts</strong>
              <span>Top priority risk zones</span>
            </div>
            <span>{alerts.length}</span>
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
                    {alert.severity} · {Math.round(alert.probability * 100)}%
                    probability
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
            See all alerts
            <i className="ti ti-arrow-right"></i>
          </a>
        </div>
      )}
    </li>
  )
}

export default AdminAlertDropdown
