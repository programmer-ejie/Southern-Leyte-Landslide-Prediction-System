import axios from 'axios'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
export const THEME_STORAGE_KEY = 'sl-lps-theme'

export function getStoredTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) ?? 'light'
}

export function applyTheme(themeMode) {
  document.documentElement.dataset.theme = themeMode
  localStorage.setItem(THEME_STORAGE_KEY, themeMode)
}

export function loadSavedTheme(setThemeMode) {
  return axios
    .get(`${API_BASE_URL}/system-settings`)
    .then((response) => {
      const themeMode = response.data?.settings?.theme_mode ?? getStoredTheme()
      applyTheme(themeMode)
      setThemeMode(themeMode)
    })
    .catch(() => {
      applyTheme(getStoredTheme())
    })
}

export function saveTheme(themeMode) {
  applyTheme(themeMode)

  return axios
    .put(`${API_BASE_URL}/system-settings`, { theme_mode: themeMode })
    .catch(() => undefined)
}
