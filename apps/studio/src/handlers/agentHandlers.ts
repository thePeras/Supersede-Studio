import { agentService } from '@/backend/agent/AgentService'
import { installClient, listClientStates, removeClient } from '@/backend/agent/AgentClients'
import type { AgentApprovalRequest, AgentClientId, AgentClientState, AgentServerInfo, TransportAgentActivity } from '@/lib/agent/types'

export interface IAgentHandlers {
  'agent/status': ({ sId }: { sId: string }) => Promise<AgentServerInfo & { clients: number }>
  'agent/activity': ({ connectionId, limit, sId }: { connectionId?: number | null, limit?: number, sId: string }) => Promise<TransportAgentActivity>
  'agent/clearActivity': ({ sId }: { sId: string }) => Promise<void>
  'agent/pendingApprovals': ({ sId }: { sId: string }) => Promise<AgentApprovalRequest[]>
  'agent/decideApproval': ({ id, approved, sId }: { id: string, approved: boolean, sId: string }) => Promise<boolean>
  'agent/clients': ({ sId }: { sId: string }) => Promise<AgentClientState[]>
  'agent/installClient': ({ client, sId }: { client: AgentClientId, sId: string }) => Promise<AgentClientState>
  'agent/removeClient': ({ client, sId }: { client: AgentClientId, sId: string }) => Promise<AgentClientState>
}

export const AgentHandlers: IAgentHandlers = {
  'agent/status': async function() {
    return agentService.status()
  },
  'agent/activity': async function({ connectionId, limit }) {
    return await agentService.recorder.activity({ connectionId, limit })
  },
  'agent/clearActivity': async function() {
    await agentService.clearActivity()
  },
  'agent/pendingApprovals': async function() {
    return agentService.approvals.list()
  },
  'agent/decideApproval': async function({ id, approved }) {
    return agentService.approvals.decide(id, !!approved)
  },
  'agent/clients': async function() {
    return await listClientStates()
  },
  'agent/installClient': async function({ client }) {
    return await installClient(client)
  },
  'agent/removeClient': async function({ client }) {
    return await removeClient(client)
  },
}
