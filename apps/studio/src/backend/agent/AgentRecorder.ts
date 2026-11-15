import { In, LessThan, Not } from 'typeorm'
import { AgentSession } from '@/common/appdb/models/AgentSession'
import { AgentCall } from '@/common/appdb/models/AgentCall'
import { UsedQuery } from '@/common/appdb/models/used_query'
import type { CallDecision, CallStatus, IdentitySource, QueryKind, RelayHello, TransportAgentActivity, WriteCategory } from '@/lib/agent/types'
import { clientDisplayName, resolveSessionLabel } from '@/lib/agent/identity'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentRecorder')

const MAX_CALLS = 10_000
const SESSION_RETENTION_DAYS = 90

export interface CallRecord {
  session: AgentSession
  tool: string
  input?: unknown
  connectionId?: number | null
  connectionName?: string | null
  database?: string | null
  sql?: string | null
  kind?: QueryKind | null
  categories?: WriteCategory[]
  decision: CallDecision
  status: CallStatus
  error?: string | null
  rowCount?: number | null
  durationMs?: number | null
}

export class AgentRecorder {
  constructor(private onActivity: (payload: { sessionId: number | null, callId: number | null, connectionId: number | null }) => void) {}

  async startSession(input: {
    clientName?: string | null
    clientVersion?: string | null
    hello?: RelayHello | null
    parent?: AgentSession | null
    title?: string | null
    identitySource?: IdentitySource
  }): Promise<AgentSession> {
    const label = resolveSessionLabel({
      clientName: input.clientName ?? input.parent?.clientName,
      cwd: input.hello?.cwd ?? input.parent?.cwd,
      env: input.hello?.env,
    })
    const session = new AgentSession().withProps({
      clientName: input.clientName ?? input.parent?.clientName ?? null,
      clientVersion: input.clientVersion ?? input.parent?.clientVersion ?? null,
      label: input.title || label,
      title: input.title ?? null,
      cwd: input.hello?.cwd ?? input.parent?.cwd ?? null,
      identitySource: input.identitySource ?? 'client',
      pid: input.hello?.ppid ?? input.parent?.pid ?? null,
      parentSessionId: input.parent?.id ?? null,
      lastSeenAt: new Date(),
    })
    return await session.save()
  }

  async recordCall(record: CallRecord): Promise<AgentCall | null> {
    try {
      return await this.saveCall(record)
    } catch (e) {
      log.error('Could not record agent call', e)
      return null
    }
  }

  private async saveCall(record: CallRecord): Promise<AgentCall> {
    const call = new AgentCall().withProps({
      sessionId: record.session.id,
      tool: record.tool,
      input: record.input === undefined ? null : safeJson(record.input),
      connectionId: record.connectionId ?? null,
      connectionName: record.connectionName ?? null,
      database: record.database ?? null,
      sql: record.sql ?? null,
      kind: record.kind ?? null,
      categories: record.categories?.length ? record.categories.join(',') : null,
      decision: record.decision,
      status: record.status,
      error: record.error ?? null,
      rowCount: record.rowCount ?? null,
      durationMs: record.durationMs ?? null,
    })
    await call.save()

    record.session.lastSeenAt = new Date()
    await AgentSession.update(record.session.id, { lastSeenAt: record.session.lastSeenAt }).catch((e) => log.warn(e))

    if (record.tool === 'run_query' && record.sql && record.connectionId && record.status !== 'rejected') {
      try {
        const used = new UsedQuery().withProps({
          text: record.sql,
          excerpt: record.sql.substr(0, 250),
          database: record.database || '[blank]',
          connectionId: record.connectionId,
          numberOfRecords: record.rowCount ?? 0,
          status: record.status === 'ok' ? 'completed' : 'failed',
          agentCallId: call.id,
          agentLabel: clientDisplayName(record.session.clientName),
        })
        await used.save()
      } catch (e) {
        log.warn('Could not record history for agent query', e)
      }
    }

    this.onActivity({ sessionId: record.session.id, callId: call.id, connectionId: call.connectionId })
    return call
  }

  async activity(options: { connectionId?: number | null, limit?: number } = {}): Promise<TransportAgentActivity> {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000)
    const calls = await AgentCall.find({
      where: options.connectionId ? { connectionId: options.connectionId } : {},
      order: { id: 'DESC' },
      take: limit,
    })
    const sessionIds = Array.from(new Set(calls.map((c) => c.sessionId)))
    const sessions = sessionIds.length
      ? await AgentSession.find({ where: { id: In(sessionIds) } })
      : []
    return {
      sessions: sessions.map((s) => s.toTransport()),
      calls: calls.map((c) => c.toTransport()),
    }
  }

  async clear(keepSessionIds: number[] = []): Promise<void> {
    await AgentCall.createQueryBuilder().delete().execute()
    if (keepSessionIds.length) {
      await AgentSession.delete({ id: Not(In(keepSessionIds)) })
    } else {
      await AgentSession.createQueryBuilder().delete().execute()
    }
    this.onActivity({ sessionId: null, callId: null, connectionId: null })
  }

  async prune(): Promise<void> {
    try {
      const cutoff = await AgentCall.find({ order: { id: 'DESC' }, skip: MAX_CALLS, take: 1 })
      if (cutoff.length) {
        await AgentCall.delete({ id: LessThan(cutoff[0].id + 1) })
      }
      const before = new Date(Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      const stale = await AgentSession.find({ select: ['id'], where: { lastSeenAt: LessThan(before) } })
      const staleIds = stale.map((s) => s.id)
      if (staleIds.length) {
        const used = await AgentCall.find({ select: ['sessionId'], where: { sessionId: In(staleIds) } })
        const usedIds = new Set(used.map((c) => c.sessionId))
        const removable = staleIds.filter((id) => !usedIds.has(id))
        if (removable.length) await AgentSession.delete({ id: In(removable) })
      }
    } catch (e) {
      log.warn('Could not prune agent activity', e)
    }
  }
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}
