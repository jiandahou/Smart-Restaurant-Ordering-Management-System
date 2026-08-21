export const LEGAL_VERSIONS = {
  customerTerms: '2026-08-08',
  privacyPolicy: '2026-08-08',
  allergenNotice: '2026-08-08',
} as const

export const legalOperator = {
  name: import.meta.env.VITE_LEGAL_OPERATOR_NAME || 'DineFlow',
  abn: import.meta.env.VITE_LEGAL_OPERATOR_ABN || '',
  address: import.meta.env.VITE_LEGAL_OPERATOR_ADDRESS || '',
  privacyEmail: import.meta.env.VITE_LEGAL_PRIVACY_EMAIL || '',
  supportEmail: import.meta.env.VITE_LEGAL_SUPPORT_EMAIL || '',
}

export function operatorDisplayName() {
  return legalOperator.abn
    ? `${legalOperator.name} (ABN ${legalOperator.abn})`
    : legalOperator.name
}
