// Light / dark / system, remembered per browser. The stylesheet defines the
// palette on :root, redefines it under prefers-color-scheme: dark, and again
// under [data-theme] so an explicit choice wins in both directions.

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'ufo-web-theme'

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage unavailable */
  }
}

export function nextTheme(current: Theme): Theme {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  if (current === 'system') return prefersDark ? 'light' : 'dark'
  return current === 'dark' ? 'light' : 'dark'
}

export function effectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
