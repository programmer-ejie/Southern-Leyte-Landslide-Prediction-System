import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'
import { getAuthToken, isAdminUser } from './auth-session'
import { API_BASE_URL, applyTheme, getStoredTheme, loadSavedTheme, saveTheme } from './theme-settings'

const AUTH_USER_KEY = 'sl-lps-auth-user'
const DEFAULT_OFFICE = 'Provincial Disaster Risk Reduction and Management Office'

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null') ?? {}
  } catch (_) {
    return {}
  }
}

function getInitials(user) {
  const firstInitial = user.firstName?.trim()?.[0] || ''
  const lastInitial = user.lastName?.trim()?.[0] || ''
  return `${firstInitial}${lastInitial}`.toUpperCase() || 'SL'
}

function getFullName(user) {
  const middleInitial = user.middleName?.trim()?.[0]

  return [user.firstName, middleInitial ? `${middleInitial}.` : '', user.lastName]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Southern Leyte Admin'
}

function getProfileNameFontSize(name) {
  const length = Math.max(name.length, 1)
  const estimatedSize = Math.floor(280 / (length * 0.68))

  return `${Math.max(10, Math.min(24, estimatedSize))}px`
}

function notifyProfileUpdate(profile) {
  window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: profile }))
}

function ProfilePage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const apiHasConnectedRef = useRef(false)
  const photoInputRef = useRef(null)
  const [themeMode, setThemeMode] = useState(
    getStoredTheme,
  )
  const [profileStatus, setProfileStatus] = useState('idle')
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false)
  const [profile, setProfile] = useState(() => {
    const storedUser = getStoredUser()

    return {
      firstName: storedUser.firstName ?? '',
      middleName: storedUser.middleName ?? '',
      lastName: storedUser.lastName ?? '',
      email: storedUser.email ?? '',
      role: storedUser.role ?? 'admin',
      office: DEFAULT_OFFICE,
      phone: storedUser.phone ?? '',
      jobRole: storedUser.jobRole ?? storedUser.position ?? 'System Administrator',
      coverage: storedUser.coverage ?? 'Southern Leyte',
      photoDataUrl: storedUser.photoDataUrl ?? '',
    }
  })

  function markApiConnected() {
    apiHasConnectedRef.current = true
    setApiStatus('connected')
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${getAuthToken()}`,
    }
  }

  function applyProfile(nextProfile) {
    const normalizedProfile = {
      ...nextProfile,
      office: DEFAULT_OFFICE,
      coverage: nextProfile.coverage ?? 'Southern Leyte',
      phone: nextProfile.phone ?? '',
      photoDataUrl: nextProfile.photoDataUrl ?? '',
      jobRole:
        nextProfile.jobRole ??
        nextProfile.position ??
        (nextProfile.role === 'admin' ? 'System Administrator' : ''),
    }

    setProfile(normalizedProfile)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(normalizedProfile))
    notifyProfileUpdate(normalizedProfile)
    setPhotoLoadFailed(false)
  }

  useEffect(() => {
    applyTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    loadSavedTheme(setThemeMode)
  }, [])

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
    setProfileStatus('loading')

    axios
      .get(`${API_BASE_URL}/profile`, { headers: authHeaders() })
      .then((response) => {
        markApiConnected()
        applyProfile(response.data?.profile ?? {})
        setProfileStatus('ready')
      })
      .catch(() => setProfileStatus('local'))
  }, [])

  function updateThemeMode(nextThemeMode) {
    setThemeMode(nextThemeMode)
    saveTheme(nextThemeMode)
  }

  function updateProfile(field, value) {
    setProfile((currentProfile) => {
      const nextProfile = {
        ...currentProfile,
        [field]: value,
      }
      if (field === 'photoDataUrl') {
        setPhotoLoadFailed(false)
      }
      notifyProfileUpdate(nextProfile)
      return nextProfile
    })
  }

  function uploadProfilePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setProfileStatus('photo-error')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      updateProfile('photoDataUrl', reader.result)
      setProfileStatus('photo-ready')
    }
    reader.readAsDataURL(file)
  }

  function saveProfile(event) {
    event.preventDefault()
    const payload = {
      ...profile,
      office: DEFAULT_OFFICE,
    }

    setProfileStatus('saving')

    axios
      .put(`${API_BASE_URL}/profile`, payload, { headers: authHeaders() })
      .then((response) => {
        markApiConnected()
        applyProfile(response.data?.profile ?? payload)
        setProfileStatus('saved')
        window.setTimeout(() => setProfileStatus('ready'), 2200)
      })
      .catch(() => {
        setProfileStatus('failed')
      })
  }

  const fullName = getFullName(profile)
  const initials = getInitials(profile)
  const profileNameFontSize = getProfileNameFontSize(fullName)
  const shouldShowProfilePhoto = profile.photoDataUrl && !photoLoadFailed

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
            <a className="nav-link active" href="/admin/profile">
              <i className="ti ti-user-circle"></i>
              <span className="nav-text">Profile</span>
            </a>
          </li>
          {isAdminUser() ? (
            <li>
              <a className="nav-link" href="/admin/accounts">
                <i className="ti ti-users-plus"></i>
                <span className="nav-text">Accounts</span>
              </a>
            </li>
          ) : null}
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
          <div className="fw-semibold">Profile</div>
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
                updateThemeMode(themeMode === 'dark' ? 'light' : 'dark')
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
          <AdminAlertDropdown />
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
                <span className="prediction-kicker">Account center</span>
                <h1 className="fs-3 mb-1">Profile</h1>
                <p className="text-secondary mb-0">
                  Manage your account identity, contact details, and operational access
                  summary.
                </p>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-4">
              <div className="card profile-hero-card h-100">
                <div className="card-body p-4">
                  <div className="profile-photo-wrap">
                    <div className="profile-avatar-xl">
                      {shouldShowProfilePhoto ? (
                        <img
                          src={profile.photoDataUrl}
                          alt={`${fullName} profile`}
                          onError={() => setPhotoLoadFailed(true)}
                        />
                      ) : (
                        initials
                      )}
                    </div>
                    <button
                      type="button"
                      className="profile-photo-button"
                      onClick={() => photoInputRef.current?.click()}
                      aria-label="Upload profile photo"
                    >
                      <i className="ti ti-camera"></i>
                    </button>
                  </div>
                  <input
                    ref={photoInputRef}
                    className="visually-hidden"
                    type="file"
                    accept="image/*"
                    onChange={uploadProfilePhoto}
                  />
                  <span className="profile-role-pill text-capitalize">{profile.role}</span>
                  <h2 className="profile-name" style={{ fontSize: profileNameFontSize }}>
                    {fullName}
                  </h2>
                  <p className="profile-email">{profile.email || 'No email on file'}</p>

                  <div className="profile-quick-list">
                    <ProfileQuickItem icon="ti-building-community" label="Office" value={profile.office} />
                    <ProfileQuickItem icon="ti-id-badge-2" label="Job role" value={profile.jobRole} />
                    <ProfileQuickItem icon="ti-map-pin" label="Coverage" value={profile.coverage} />
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-8">
              <form className="card profile-form-card h-100" onSubmit={saveProfile}>
                {profileStatus === 'saving' ? (
                  <div className="profile-save-overlay" aria-live="polite">
                    <span className="prediction-loader-ring"></span>
                    <strong>Saving to database</strong>
                  </div>
                ) : null}
                <div className="card-header bg-white px-4 py-3 profile-card-heading">
                  <div>
                    <h4 className="mb-0 h5">Profile Details</h4>
                    <span>Keep your account display information clear for reports and advisories.</span>
                  </div>
                </div>
                <div className="card-body p-4">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="settings-field">
                        <span>First name</span>
                        <input
                          className="form-control"
                          value={profile.firstName}
                          onChange={(event) => updateProfile('firstName', event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="col-md-4">
                      <label className="settings-field">
                        <span>Middle name</span>
                        <input
                          className="form-control"
                          value={profile.middleName}
                          onChange={(event) => updateProfile('middleName', event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="col-md-4">
                      <label className="settings-field">
                        <span>Last name</span>
                        <input
                          className="form-control"
                          value={profile.lastName}
                          onChange={(event) => updateProfile('lastName', event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="col-md-6">
                      <label className="settings-field">
                        <span>Email address</span>
                        <input
                          className="form-control"
                          type="email"
                          value={profile.email}
                          onChange={(event) => updateProfile('email', event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="col-md-6">
                      <label className="settings-field">
                        <span>Phone number</span>
                        <input
                          className="form-control"
                          value={profile.phone}
                          onChange={(event) => updateProfile('phone', event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="col-md-6">
                      <label className="settings-field">
                        <span>Office</span>
                        <input
                          className="form-control"
                          value={DEFAULT_OFFICE}
                          readOnly
                          aria-readonly="true"
                        />
                      </label>
                    </div>
                    <div className="col-md-6">
                      <label className="settings-field">
                        <span>Job role</span>
                        <input
                          className="form-control"
                          value={profile.jobRole}
                          onChange={(event) => updateProfile('jobRole', event.target.value)}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-action-row profile-action-row mt-4">
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={profileStatus === 'saving'}
                    >
                      {profileStatus === 'saving' ? (
                        <span className="btn-save-spinner" aria-hidden="true"></span>
                      ) : (
                        <i className="ti ti-device-floppy me-1"></i>
                      )}
                      {profileStatus === 'saving' ? 'Saving...' : 'Save Profile'}
                    </button>
                    <a className="btn btn-outline-primary" href="/admin/settings">
                      <i className="ti ti-settings me-1"></i>
                      System Settings
                    </a>
                  </div>
                  <p className={`predict-status predict-status--${profileStatus}`}>
                    Profile:{' '}
                    {profileStatus === 'saved'
                      ? 'saved to database'
                      : profileStatus === 'saving'
                        ? 'saving...'
                        : profileStatus === 'loading'
                          ? 'loading...'
                          : profileStatus === 'failed'
                            ? 'database save failed'
                      : profileStatus === 'photo-ready'
                        ? 'photo ready to save'
                        : profileStatus === 'photo-error'
                          ? 'please choose an image file'
                          : 'ready'}
                  </p>
                </div>
              </form>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3 profile-card-heading">
                  <div>
                    <h4 className="mb-0 h5">Access Summary</h4>
                    <span>Operational sections available to this account.</span>
                  </div>
                </div>
                <div className="card-body p-4">
                  <div className="profile-permission-list">
                    <ProfilePermission icon="ti-map-search" title="Prediction Map" text="View live landslide risk layers and barangay exposure details." />
                    <ProfilePermission icon="ti-alert-triangle" title="Alerts" text="Review priority alerts and generate public advisory documents." />
                    <ProfilePermission icon="ti-cloud-rain" title="Rainfall Simulation" text="Run rainfall scenarios and compare impact logs." />
                    <ProfilePermission icon="ti-settings" title="System Settings" text="Manage appearance, exports, and operational controls." />
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3 profile-card-heading">
                  <div>
                    <h4 className="mb-0 h5">Account Health</h4>
                    <span>Current session and interface state.</span>
                  </div>
                </div>
                <div className="card-body p-4">
                  <div className="settings-default-grid">
                    <ProfileMetric label="Session role" value={profile.role} />
                    <ProfileMetric label="API status" value={apiStatus} />
                    <ProfileMetric label="Theme mode" value={themeMode} />
                    <ProfileMetric label="Coverage area" value={profile.coverage} />
                  </div>
                  <div className="settings-note mt-4">
                    <strong>Profile storage</strong>
                    <span>
                      Name, contact details, job role, and photo are saved in the
                      database for this account.
                    </span>
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
                  <span>Profile</span>
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

function ProfileQuickItem({ icon, label, value }) {
  return (
    <div className="profile-quick-item">
      <i className={`ti ${icon}`}></i>
      <div>
        <span>{label}</span>
        <strong>{value || 'Not set'}</strong>
      </div>
    </div>
  )
}

function ProfilePermission({ icon, title, text }) {
  return (
    <div className="profile-permission-item">
      <div className="icon-shape icon-sm bg-primary bg-opacity-10 text-primary rounded-2">
        <i className={`ti ${icon}`}></i>
      </div>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <i className="ti ti-check text-success"></i>
    </div>
  )
}

function ProfileMetric({ label, value }) {
  return (
    <div className="preview-item">
      <span>{label}</span>
      <strong className="text-capitalize">{value || 'Not set'}</strong>
    </div>
  )
}

export default ProfilePage
