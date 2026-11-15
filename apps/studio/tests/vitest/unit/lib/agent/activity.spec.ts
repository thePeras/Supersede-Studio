import { describe, it, expect } from 'vitest'
import { buildActivityTree, clientOptions, filterCalls } from '@/lib/agent/activity'
import type { TransportAgentCall, TransportAgentSession } from '@/lib/agent/types'

function session(id: number, overrides: Partial<TransportAgentSession> = {}): TransportAgentSession {
  return {
    id,
    clientName: 'claude-code',
    clientVersion: '1.0',
    label: `session-${id}`,
    title: null,
    cwd: null,
    identitySource: 'client',
    firstSeenAt: new Date(0),
    lastSeenAt: new Date(0),
    ...overrides,
  }
}

function call(id: number, sessionId: number, overrides: Partial<TransportAgentCall> = {}): TransportAgentCall {
  return {
    id,
    sessionId,
    connectionId: 1,
    connectionName: 'prod',
    database: null,
    tool: 'run_query',
    sql: 'select 1',
    kind: 'read',
    categories: [],
    decision: 'auto',
    status: 'ok',
    error: null,
    rowCount: 1,
    durationMs: 3,
    createdAt: new Date(id * 1000),
    ...overrides,
  }
}

describe('buildActivityTree', () => {
  const sessions = [
    session(1, { label: 'feature-x' }),
    session(2, { label: 'fix-ssh', clientName: 'codex-mcp-client' }),
    session(3, { label: 'Claude Desktop', title: 'Slow orders', identitySource: 'model', clientName: 'claude-ai' }),
  ]
  const calls = [
    call(1, 1),
    call(2, 2, { kind: 'write', categories: ['delete'], decision: 'approved', sql: 'delete from x' }),
    call(3, 1),
    call(4, 3, { connectionId: 2, connectionName: 'staging' }),
  ]

  it('groups calls by session, most recent first', () => {
    const tree = buildActivityTree(sessions, calls)
    expect(tree.map((s) => s.label)).toEqual(['Slow orders', 'feature-x', 'fix-ssh'])
    expect(tree[1].calls.map((c) => c.id)).toEqual([3, 1])
    expect(tree[2].clientLabel).toBe('Codex')
  })

  it('prefers the model-reported title as the label', () => {
    const tree = buildActivityTree(sessions, calls)
    expect(tree[0].label).toBe('Slow orders')
  })

  it('applies filters before grouping', () => {
    const tree = buildActivityTree(sessions, calls, { kind: 'write' })
    expect(tree).toHaveLength(1)
    expect(tree[0].calls[0].id).toBe(2)
  })

  it('filters by connection, client and search text', () => {
    const byId = new Map(sessions.map((s) => [s.id, s]))
    expect(filterCalls(calls, byId, { connectionId: 2 }).map((c) => c.id)).toEqual([4])
    expect(filterCalls(calls, byId, { client: 'Codex' }).map((c) => c.id)).toEqual([2])
    expect(filterCalls(calls, byId, { search: 'DELETE' }).map((c) => c.id)).toEqual([2])
    expect(filterCalls(calls, byId, { decision: 'approved' }).map((c) => c.id)).toEqual([2])
    expect(filterCalls(calls, byId, { kind: 'delete' }).map((c) => c.id)).toEqual([2])
    expect(filterCalls(calls, byId, { kind: 'create' })).toEqual([])
    expect(filterCalls(calls, byId, { kind: 'read' }).map((c) => c.id)).toEqual([1, 3, 4])
  })

  it('lists client names once', () => {
    expect(clientOptions(sessions)).toEqual(['Claude Code', 'Claude Desktop', 'Codex'])
  })
})
