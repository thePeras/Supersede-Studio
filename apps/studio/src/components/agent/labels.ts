import type { AgentClientStatus, CallDecision } from '@/lib/agent/types'

export const decisionLabels: Record<CallDecision, string> = {
  auto: 'Success',
  approved: 'Approved',
  denied: 'Denied',
  timeout: 'Timed out',
  blocked: 'Blocked',
}

export const clientStatusLabels: Record<AgentClientStatus, string> = {
  not_configured: 'Not configured',
  configured: 'Configured',
  outdated: 'Outdated path',
  error: 'Error',
}

const LEGACY_HINT = " Change it in the connection's Agent Access settings in Supersede Studio."

export function displayError(error?: string | null): string | null {
  return error ? error.replace(LEGACY_HINT, '') : error ?? null
}
