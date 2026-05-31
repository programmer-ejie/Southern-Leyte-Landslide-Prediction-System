import { useEffect, useRef, useState } from 'react'

const AUTH_USER_KEY = 'sl-lps-auth-user'

function getUserInitials() {
  try {
    const user = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null')
    const firstInitial = user?.firstName?.trim()?.[0] || ''
    const lastInitial = user?.lastName?.trim()?.[0] || ''
    const initials = `${firstInitial}${lastInitial}`.toUpperCase()

    return initials || 'SL'
  } catch (_) {
    return 'SL'
  }
}

function AdminProfileMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [initials, setInitials] = useState(() => getUserInitials())
  const menuRef = useRef(null)

  useEffect(() => {
    function handleDocumentClick(event) {
      if (!menuRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentClick)
    return () => document.removeEventListener('mousedown', handleDocumentClick)
  }, [])

  useEffect(() => {
    setInitials(getUserInitials())
  }, [])

  return (
    <li className="position-relative" ref={menuRef}>
      <button
        type="button"
        className="avatar avatar-sm avatar-primary rounded-circle overflow-hidden profile-menu-toggle"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label="Open profile menu"
      >
        <span className="avatar-initials rounded-circle">{initials}</span>
      </button>

      {isOpen ? (
        <div className="profile-dropdown">
          <a className="profile-dropdown-item" href="/admin/reports">
            <i className="ti ti-receipt"></i>
            <span>Reports</span>
          </a>
          <a className="profile-dropdown-item" href="/admin/settings">
            <i className="ti ti-settings"></i>
            <span>Settings</span>
          </a>
          <a className="profile-dropdown-item profile-dropdown-item--danger" href="/logout">
            <i className="ti ti-logout"></i>
            <span>Logout</span>
          </a>
        </div>
      ) : null}
    </li>
  )
}

export default AdminProfileMenu
