import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import '../../public/admin_template/src/assets/scss/style.scss'
import '../App.css'
import AdminAlertDropdown from './AdminAlertDropdown'
import AdminProfileMenu from './AdminProfileMenu'
import { getAuthToken } from './auth-session'
import { API_BASE_URL, applyTheme, getStoredTheme, loadSavedTheme, saveTheme } from './theme-settings'

const emptyForm = {
  firstName: '',
  middleName: '',
  lastName: '',
  email: '',
  password: '',
  jobRole: '',
}

function formatAccountName(account) {
  const middleInitial = account.middleName?.trim()?.[0]

  return [
    account.firstName,
    middleInitial ? `${middleInitial}.` : '',
    account.lastName,
  ]
    .filter(Boolean)
    .join(' ')
}

function AccountsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const apiHasConnectedRef = useRef(false)
  const [themeMode, setThemeMode] = useState(
    getStoredTheme,
  )
  const [accounts, setAccounts] = useState([])
  const [accountStatus, setAccountStatus] = useState('loading')
  const [createStatus, setCreateStatus] = useState('idle')
  const [createPanelOpen, setCreatePanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState('create')
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [form, setForm] = useState(emptyForm)

  function markApiConnected() {
    apiHasConnectedRef.current = true
    setApiStatus('connected')
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${getAuthToken()}`,
    }
  }

  function loadAccounts() {
    setAccountStatus('loading')
    setErrorMessage('')

    return axios
      .get(`${API_BASE_URL}/accounts`, { headers: authHeaders() })
      .then((response) => {
        markApiConnected()
        setAccounts(response.data?.accounts ?? [])
        setAccountStatus('loaded')
      })
      .catch((error) => {
        setAccountStatus('failed')
        setErrorMessage(error.response?.data?.detail ?? 'Unable to load accounts.')
      })
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
    loadAccounts()
    const intervalId = window.setInterval(checkApiHealth, 30000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  function updateThemeMode(nextThemeMode) {
    setThemeMode(nextThemeMode)
    saveTheme(nextThemeMode)
  }

  function updateForm(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function openCreatePanel() {
    setPanelMode('create')
    setEditingAccountId(null)
    setForm(emptyForm)
    setPasswordVisible(false)
    setErrorMessage('')
    setCreatePanelOpen(true)
  }

  function openEditPanel(account) {
    setPanelMode('edit')
    setEditingAccountId(account.id)
    setForm({
      firstName: account.firstName ?? '',
      middleName: account.middleName ?? '',
      lastName: account.lastName ?? '',
      email: account.email ?? '',
      password: '',
      jobRole: account.jobRole ?? '',
    })
    setPasswordVisible(false)
    setErrorMessage('')
    setCreatePanelOpen(true)
  }

  function closePanel() {
    setCreatePanelOpen(false)
    setPanelMode('create')
    setEditingAccountId(null)
    setForm(emptyForm)
    setPasswordVisible(false)
    setErrorMessage('')
  }

  function saveAccount(event) {
    event.preventDefault()
    const isEditing = panelMode === 'edit'
    setCreateStatus(isEditing ? 'updating' : 'creating')
    setErrorMessage('')
    const payload = {
      ...form,
      password: form.password || undefined,
    }
    const request = isEditing
      ? axios.put(`${API_BASE_URL}/accounts/${editingAccountId}`, payload, {
          headers: authHeaders(),
        })
      : axios.post(`${API_BASE_URL}/accounts`, form, { headers: authHeaders() })

    request
      .then((response) => {
        markApiConnected()
        setAccounts((currentAccounts) =>
          isEditing
            ? currentAccounts.map((account) =>
                account.id === response.data.account.id ? response.data.account : account,
              )
            : [response.data.account, ...currentAccounts],
        )
        setForm(emptyForm)
        setCreateStatus(isEditing ? 'updated' : 'created')
        setCreatePanelOpen(false)
        window.setTimeout(() => setCreateStatus('idle'), 2400)
      })
      .catch((error) => {
        setCreateStatus('failed')
        setErrorMessage(
          error.response?.data?.detail ??
            (isEditing ? 'Unable to update account.' : 'Unable to create account.'),
        )
      })
  }

  function deleteAccount(account) {
    const accountName = [account.firstName, account.middleName, account.lastName]
      .filter(Boolean)
      .join(' ')

    if (!window.confirm(`Delete user account "${accountName}"?`)) {
      return
    }

    setCreateStatus('deleting')
    setErrorMessage('')

    axios
      .delete(`${API_BASE_URL}/accounts/${account.id}`, { headers: authHeaders() })
      .then(() => {
        setAccounts((currentAccounts) =>
          currentAccounts.filter((currentAccount) => currentAccount.id !== account.id),
        )
        setCreateStatus('deleted')
        window.setTimeout(() => setCreateStatus('idle'), 2400)
      })
      .catch((error) => {
        setCreateStatus('failed')
        setErrorMessage(error.response?.data?.detail ?? 'Unable to delete account.')
      })
  }

  const adminAccounts = accounts.filter((account) => account.role === 'admin')
  const userAccounts = accounts.filter((account) => account.role === 'user')
  const isEditing = panelMode === 'edit'

  return (
    <>
      <div
        id="overlay"
        className={`overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      ></div>
      <div
        className={`account-offcanvas-backdrop ${createPanelOpen ? 'show' : ''}`}
        onClick={() => setCreatePanelOpen(false)}
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
            <a className="nav-link" href="/admin/profile">
              <i className="ti ti-user-circle"></i>
              <span className="nav-text">Profile</span>
            </a>
          </li>
          <li>
            <a className="nav-link active" href="/admin/accounts">
              <i className="ti ti-users-plus"></i>
              <span className="nav-text">Accounts</span>
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
          <div className="fw-semibold">Accounts</div>
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
              <div className="account-page-header mb-4">
                <div>
                  <span className="prediction-kicker">Admin only</span>
                  <h1 className="fs-3 mb-1">Registered Accounts</h1>
                  <p className="text-secondary mb-0">
                    Review who can access the monitoring console.
                  </p>
                </div>
                <div className="account-header-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={openCreatePanel}
                  >
                    <i className="ti ti-user-plus me-1"></i>
                    Create User
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={loadAccounts}
                    disabled={accountStatus === 'loading'}
                  >
                    <i className="ti ti-refresh me-1"></i>
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3 profile-card-heading">
                  <div>
                    <h4 className="mb-0 h5">Admin Accounts</h4>
                    <span>Admin accounts can manage users and system access.</span>
                  </div>
                </div>
                <div className="card-body p-0">
                  <AccountTable
                    accounts={adminAccounts}
                    accountStatus={accountStatus}
                    emptyLabel="No admin accounts found."
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12">
              <div className="card h-100">
                <div className="card-header bg-white px-4 py-3 profile-card-heading">
                  <div>
                    <h4 className="mb-0 h5">User Accounts</h4>
                    <span>Users can monitor the system but cannot open this page.</span>
                  </div>
                </div>
                <div className="card-body p-0">
                  <AccountTable
                    accounts={userAccounts}
                    accountStatus={accountStatus}
                    emptyLabel="No user accounts found."
                    onEdit={openEditPanel}
                    onDelete={deleteAccount}
                    showActions
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <aside
        className={`account-offcanvas ${createPanelOpen ? 'show' : ''}`}
        aria-hidden={!createPanelOpen}
      >
        <form className="account-offcanvas-panel" onSubmit={saveAccount}>
          <div className="account-offcanvas-header">
            <div>
              <span className="prediction-kicker">
                {isEditing ? 'User maintenance' : 'User registration'}
              </span>
              <h2>{isEditing ? 'Edit User Account' : 'Create User Account'}</h2>
              <p>
                {isEditing
                  ? 'Update user details or set a new password.'
                  : 'New accounts are created with the user role.'}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-light btn-icon btn-sm"
              onClick={closePanel}
              aria-label="Close account form"
            >
              <i className="ti ti-x"></i>
            </button>
          </div>

          <div className="account-offcanvas-body">
            <div className="row g-3">
              <div className="col-md-6">
                <label className="settings-field">
                  <span>First name</span>
                  <input
                    className="form-control"
                    placeholder="e.g. Juan"
                    value={form.firstName}
                    onChange={(event) => updateForm('firstName', event.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="col-md-6">
                <label className="settings-field">
                  <span>Last name</span>
                  <input
                    className="form-control"
                    placeholder="e.g. Dela Cruz"
                    value={form.lastName}
                    onChange={(event) => updateForm('lastName', event.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="col-12">
                <label className="settings-field">
                  <span>Middle name</span>
                  <input
                    className="form-control"
                    placeholder="e.g. Santos"
                    value={form.middleName}
                    onChange={(event) => updateForm('middleName', event.target.value)}
                  />
                </label>
              </div>
              <div className="col-12">
                <label className="settings-field">
                  <span>Email address</span>
                  <input
                    className="form-control"
                    type="email"
                    placeholder="e.g. juan.delacruz@lgu.gov.ph"
                    value={form.email}
                    onChange={(event) => updateForm('email', event.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="col-12">
                <label className="settings-field">
                  <span>Password</span>
                  <span className="account-password-field">
                    <input
                      className="form-control"
                      type={passwordVisible ? 'text' : 'password'}
                      minLength={8}
                      placeholder={
                        isEditing ? 'Leave blank to keep current password' : 'At least 8 characters'
                      }
                      value={form.password}
                      onChange={(event) => updateForm('password', event.target.value)}
                      required={!isEditing}
                    />
                    <button
                      type="button"
                      className="account-password-toggle"
                      onClick={() => setPasswordVisible((isVisible) => !isVisible)}
                      aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    >
                      <i className={`ti ${passwordVisible ? 'ti-eye-off' : 'ti-eye'}`}></i>
                    </button>
                  </span>
                </label>
              </div>
              <div className="col-12">
                <label className="settings-field">
                  <span>Job role</span>
                  <input
                    className="form-control"
                    placeholder="e.g. LGU staff"
                    value={form.jobRole}
                    onChange={(event) => updateForm('jobRole', event.target.value)}
                  />
                </label>
              </div>
            </div>

            {errorMessage ? (
              <div className="settings-note account-error mt-3">
                <strong>Action needed</strong>
                <span>{errorMessage}</span>
              </div>
            ) : null}
          </div>

          <div className="account-offcanvas-footer">
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={closePanel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={['creating', 'updating'].includes(createStatus)}
            >
              <i className={`ti ${isEditing ? 'ti-device-floppy' : 'ti-user-plus'} me-1`}></i>
              {createStatus === 'creating'
                ? 'Creating...'
                : createStatus === 'updating'
                  ? 'Updating...'
                  : isEditing
                    ? 'Save Changes'
                    : 'Create User'}
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}

function AccountTable({
  accounts,
  accountStatus,
  emptyLabel,
  showActions = false,
  onEdit,
  onDelete,
}) {
  const columnCount = showActions ? 5 : 4

  return (
    <div className="account-table-wrap">
      <table className="table account-table mb-0">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Job role</th>
            <th>Role</th>
            {showActions ? <th>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {accounts.length ? (
            accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  <strong>{formatAccountName(account)}</strong>
                </td>
                <td>{account.email}</td>
                <td>
                  {account.jobRole ||
                    (account.role === 'admin' ? 'System Administrator' : 'Not set')}
                </td>
                <td>
                  <span className={`account-role account-role--${account.role}`}>
                    {account.role}
                  </span>
                </td>
                {showActions ? (
                  <td>
                    <div className="account-row-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => onEdit(account)}
                      >
                        <i className="ti ti-pencil"></i>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => onDelete(account)}
                      >
                        <i className="ti ti-trash"></i>
                        Delete
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columnCount} className="text-center text-secondary py-5">
                {accountStatus === 'loading' ? 'Loading accounts...' : emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default AccountsPage
