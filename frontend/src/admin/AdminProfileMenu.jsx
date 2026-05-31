import { useEffect, useRef, useState } from 'react'

function AdminProfileMenu() {
  const [isOpen, setIsOpen] = useState(false)
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

  return (
    <li className="position-relative" ref={menuRef}>
      <button
        type="button"
        className="avatar avatar-sm avatar-primary rounded-circle overflow-hidden profile-menu-toggle"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label="Open profile menu"
      >
        <span className="avatar-initials rounded-circle">EJ</span>
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
