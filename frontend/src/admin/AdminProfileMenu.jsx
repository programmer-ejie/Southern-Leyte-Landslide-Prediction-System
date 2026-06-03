import { useEffect, useRef, useState } from 'react'
import { isAdminUser } from './auth-session'

const AUTH_USER_KEY = 'sl-lps-auth-user'

function getUserAvatar() {
  try {
    const user = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null')
    const firstInitial = user?.firstName?.trim()?.[0] || ''
    const lastInitial = user?.lastName?.trim()?.[0] || ''
    const initials = `${firstInitial}${lastInitial}`.toUpperCase()

    return {
      initials: initials || 'SL',
      photoDataUrl: user?.photoDataUrl || '',
    }
  } catch (_) {
    return {
      initials: 'SL',
      photoDataUrl: '',
    }
  }
}

function getAvatarFromUser(user) {
  const firstInitial = user?.firstName?.trim()?.[0] || ''
  const lastInitial = user?.lastName?.trim()?.[0] || ''
  const initials = `${firstInitial}${lastInitial}`.toUpperCase()

  return {
    initials: initials || 'SL',
    photoDataUrl: user?.photoDataUrl || '',
  }
}

function AdminProfileMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [avatar, setAvatar] = useState(() => getUserAvatar())
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false)
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
    setAvatar(getUserAvatar())

    function handleProfileUpdate(event) {
      setAvatar(event.detail ? getAvatarFromUser(event.detail) : getUserAvatar())
      setPhotoLoadFailed(false)
    }

    window.addEventListener('admin-profile-updated', handleProfileUpdate)
    return () => window.removeEventListener('admin-profile-updated', handleProfileUpdate)
  }, [])

  useEffect(() => {
    setPhotoLoadFailed(false)
  }, [avatar.photoDataUrl])

  return (
    <li className="position-relative" ref={menuRef}>
      <button
        type="button"
        className="avatar avatar-sm avatar-primary rounded-circle overflow-hidden profile-menu-toggle"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label="Open profile menu"
      >
        {avatar.photoDataUrl && !photoLoadFailed ? (
          <img src={avatar.photoDataUrl} alt="" onError={() => setPhotoLoadFailed(true)} />
        ) : (
          <span className="avatar-initials rounded-circle">{avatar.initials}</span>
        )}
      </button>

      {isOpen ? (
        <div className="profile-dropdown">
          <a className="profile-dropdown-item" href="/admin/profile">
            <i className="ti ti-user-circle"></i>
            <span>Profile</span>
          </a>
          {isAdminUser() ? (
            <a className="profile-dropdown-item" href="/admin/accounts">
              <i className="ti ti-users-plus"></i>
              <span>Accounts</span>
            </a>
          ) : null}
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
