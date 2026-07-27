export type BackgroundBrowserKind = 'edge' | 'chrome' | 'firefox' | 'safari' | 'other'

export type BackgroundBrowserGuidance = {
  kind: BackgroundBrowserKind
  browserLabel: string
  notice: string
  settingsPath: string | null
  actionLabel: string
  supportsSiteException: boolean
}

export function detectBackgroundBrowser(userAgent: string): BackgroundBrowserKind {
  if (/\b(?:Edg|EdgA|EdgiOS)\//i.test(userAgent)) return 'edge'
  if (/\b(?:Chrome|CriOS)\//i.test(userAgent) && !/\b(?:OPR|Opera)\//i.test(userAgent)) return 'chrome'
  if (/\b(?:Firefox|FxiOS)\//i.test(userAgent)) return 'firefox'
  if (/\bSafari\//i.test(userAgent) && !/\b(?:Chrome|CriOS|Chromium|OPR|Edg)\//i.test(userAgent)) return 'safari'
  return 'other'
}

export function getBackgroundBrowserGuidance(userAgent: string): BackgroundBrowserGuidance {
  const kind = detectBackgroundBrowser(userAgent)

  switch (kind) {
    case 'edge':
      return {
        kind,
        browserLabel: 'Microsoft Edge',
        notice: 'Edge can put an unfocused printing tab to sleep, stopping order updates, sound and auto-print.',
        settingsPath: 'Edge Settings → System and performance → Performance → Always keep these sites active',
        actionLabel: 'Copy site for Edge',
        supportsSiteException: true,
      }
    case 'chrome':
      return {
        kind,
        browserLabel: 'Google Chrome',
        notice: 'Chrome Memory Saver can deactivate an unused printing tab, stopping order updates, sound and auto-print.',
        settingsPath: 'Chrome Settings → Performance → Always keep these sites active',
        actionLabel: 'Copy site for Chrome',
        supportsSiteException: true,
      }
    case 'firefox':
      return {
        kind,
        browserLabel: 'Mozilla Firefox',
        notice: 'Firefox can unload inactive tabs when memory is low and does not provide the same simple per-site exception.',
        settingsPath: null,
        actionLabel: 'Show Firefox advice',
        supportsSiteException: false,
      }
    case 'safari':
      return {
        kind,
        browserLabel: 'Safari',
        notice: 'Safari may suspend background pages and does not offer this printing page a reliable per-site exception.',
        settingsPath: null,
        actionLabel: 'Show Safari advice',
        supportsSiteException: false,
      }
    default:
      return {
        kind,
        browserLabel: 'this browser',
        notice: 'This browser may suspend or unload an unfocused printing tab.',
        settingsPath: null,
        actionLabel: 'Show browser advice',
        supportsSiteException: false,
      }
  }
}
