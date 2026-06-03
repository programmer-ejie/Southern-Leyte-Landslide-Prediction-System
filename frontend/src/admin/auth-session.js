export const AUTH_USER_KEY = 'sl-lps-auth-user'
export const AUTH_TOKEN_KEY = 'sl-lps-auth-token'

export function getStoredAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null') ?? {}
  } catch (_) {
    return {}
  }
}

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) ?? ''
}

export function isAdminUser() {
  return getStoredAuthUser().role === 'admin'
}
