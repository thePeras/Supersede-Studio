import type { CallDecision, QueryKind, TransportAgentCall, TransportAgentSession, WriteCategory } from './types'
import { clientDisplayName } from './identity'

export interface ActivityFilters {
  connectionId?: number | null
  kind?: QueryKind | WriteCategory | 'all'
  decision?: CallDecision | 'all'
  client?: string | 'all'
  search?: string
}

export interface ActivitySessionNode {
  session: TransportAgentSession
  label: string
  clientLabel: string
  calls: TransportAgentCall[]
  lastAt: number
}

function time(value: Date | string | number): number {
  return new Date(value).getTime()
}

export function filterCalls(
  calls: TransportAgentCall[],
  sessionsById: Map<number, TransportAgentSession>,
  filters: ActivityFilters = {}
): TransportAgentCall[] {
  const search = filters.search?.trim().toLowerCase()
  return calls.filter((call) => {
    if (filters.connectionId && call.connectionId !== filters.connectionId) return false
    if (filters.kind && filters.kind !== 'all') {
      const matches = filters.kind === 'read' || filters.kind === 'write'
        ? call.kind === filters.kind
        : (call.categories ?? []).includes(filters.kind)
      if (!matches) return false
    }
    if (filters.decision && filters.decision !== 'all' && call.decision !== filters.decision) return false
    if (filters.client && filters.client !== 'all') {
      const session = sessionsById.get(call.sessionId)
      if (clientDisplayName(session?.clientName) !== filters.client) return false
    }
    if (search) {
      const haystack = [call.sql, call.tool, call.connectionName, call.error].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

export function buildActivityTree(
  sessions: TransportAgentSession[],
  calls: TransportAgentCall[],
  filters: ActivityFilters = {}
): ActivitySessionNode[] {
  const sessionsById = new Map(sessions.map((s) => [s.id, s]))
  const filtered = filterCalls(calls, sessionsById, filters)
  const sessionNodes = new Map<number, ActivitySessionNode>()

  for (const call of filtered) {
    const session = sessionsById.get(call.sessionId)
    if (!session) continue
    let node = sessionNodes.get(session.id)
    if (!node) {
      node = {
        session,
        label: session.title || session.label || clientDisplayName(session.clientName),
        clientLabel: clientDisplayName(session.clientName),
        calls: [],
        lastAt: 0,
      }
      sessionNodes.set(session.id, node)
    }
    node.calls.push(call)
    node.lastAt = Math.max(node.lastAt, time(call.createdAt))
  }

  const result = Array.from(sessionNodes.values())
  for (const node of result) node.calls.sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id - a.id)
  return result.sort((a, b) => b.lastAt - a.lastAt)
}

export function clientOptions(sessions: TransportAgentSession[]): string[] {
  return Array.from(new Set(sessions.map((s) => clientDisplayName(s.clientName)))).sort()
}
