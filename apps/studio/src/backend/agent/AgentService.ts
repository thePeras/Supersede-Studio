import crypto from 'crypto'
import path from 'path'
import type { AgentServerInfo } from '@/lib/agent/types'
import { AgentApprovals } from './AgentApprovals'
import { AgentConnectionPool, IDLE_TIMEOUT_MS } from './AgentConnectionPool'
import { AgentMcpSession } from './AgentMcpSession'
import { AgentRecorder } from './AgentRecorder'
import { AgentServer } from './AgentServer'
import { AgentTools } from './AgentTools'
import { agentDirectory, prepareAgentDirectory, removeEndpoint, serverCommand, socketPathFor, writeEndpoint } from './endpoint'
import { broadcast, requestAttention } from './notify'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentService')

export class AgentService {
  readonly pool = new AgentConnectionPool(IDLE_TIMEOUT_MS, () => broadcast('agentStatus', this.status()))
  readonly recorder = new AgentRecorder((payload) => broadcast('agentActivity', payload))
  readonly approvals = new AgentApprovals({
    requested: (request) => {
      broadcast('agentApprovalRequested', request)
      requestAttention(
        'Approval needed',
        `${request.clientName ?? 'An agent'} wants to run a write query on ${request.connectionName}.`
      )
    },
    resolved: (id, outcome) => broadcast('agentApprovalResolved', { id, outcome }),
  })
  readonly tools = new AgentTools(this.pool, this.approvals, this.recorder)

  private server: AgentServer | null = null
  private sessions = new Set<AgentMcpSession>()
  private token: string | null = null
  private error: string | null = null

  async start(relaySource = path.join(__dirname, 'mcp-relay.js')): Promise<void> {
    if (this.server) return
    try {
      prepareAgentDirectory(relaySource)
      const token = crypto.randomBytes(32).toString('hex')
      const socketPath = socketPathFor(agentDirectory())
      const server = new AgentServer(socketPath, token, async (transport, hello) => {
        const session = new AgentMcpSession(transport, hello, this.tools, this.recorder, (s) => {
          this.sessions.delete(s)
          broadcast('agentStatus', this.status())
        })
        this.sessions.add(session)
        await session.start()
        broadcast('agentStatus', this.status())
      })
      await server.listen()
      writeEndpoint(socketPath, token)
      this.server = server
      this.token = token
      this.error = null
      this.pool.start()
      this.recorder.prune().catch((e) => log.warn(e))
      log.info('Agent server listening on', socketPath)
    } catch (e) {
      this.error = e?.message ?? String(e)
      log.error('Could not start the agent server', e)
    }
  }

  async stop(): Promise<void> {
    this.approvals.cancelAll()
    for (const session of Array.from(this.sessions)) await session.close()
    this.sessions.clear()
    await this.server?.close()
    this.server = null
    if (this.token) removeEndpoint(this.token)
    this.token = null
    await this.pool.closeAll()
  }

  async clearActivity(): Promise<void> {
    const live = Array.from(this.sessions).flatMap((s) => s.sessionIds())
    await this.recorder.clear(live)
  }

  status(): AgentServerInfo & { clients: number, openConnectionIds: number[] } {
    return {
      running: !!this.server,
      ...serverCommand(),
      error: this.error ?? undefined,
      clients: this.sessions.size,
      openConnectionIds: this.pool.openConnectionIds(),
    }
  }
}

export const agentService = new AgentService()
