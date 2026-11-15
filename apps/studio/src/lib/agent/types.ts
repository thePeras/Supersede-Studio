export type AgentAccess = 'read' | 'approve_writes' | 'full'

export type AgentPreset = AgentAccess | 'custom'

export type WriteCategory = 'create' | 'update' | 'delete' | 'schema' | 'other'

export type StatementCategory = 'read' | WriteCategory

export type CategoryRule = 'block' | 'ask' | 'allow'

export type AgentRules = Record<WriteCategory, CategoryRule>

export interface AgentOptions {
  enabled?: boolean
  access?: AgentAccess
  rules?: Partial<AgentRules>
}

export interface NormalizedAgentOptions {
  enabled: boolean
  rules: AgentRules
}

export const defaultAgentOptions: AgentOptions = {
  enabled: false,
  rules: { create: 'block', update: 'block', delete: 'block', schema: 'block', other: 'block' },
}

export type QueryKind = 'read' | 'write'

export type PolicyDecision = 'run' | 'approve' | 'reject'

export type CallDecision = 'auto' | 'approved' | 'denied' | 'timeout' | 'blocked'

export type CallStatus = 'ok' | 'error' | 'rejected'

export type IdentitySource = 'client' | 'model'

export interface RelayHello {
  type: 'hello'
  token: string
  pid?: number
  ppid?: number
  cwd?: string
  env?: Record<string, string>
  relayVersion?: number
}

export interface TransportAgentSession {
  id: number
  clientName: string | null
  clientVersion: string | null
  label: string
  title: string | null
  cwd: string | null
  identitySource: IdentitySource
  firstSeenAt: Date
  lastSeenAt: Date
}

export interface TransportAgentCall {
  id: number
  sessionId: number
  connectionId: number | null
  connectionName: string | null
  database: string | null
  tool: string
  sql: string | null
  kind: QueryKind | null
  categories: WriteCategory[]
  decision: CallDecision
  status: CallStatus
  error: string | null
  rowCount: number | null
  durationMs: number | null
  createdAt: Date
}

export interface TransportAgentActivity {
  sessions: TransportAgentSession[]
  calls: TransportAgentCall[]
}

export interface AgentApprovalRequest {
  id: string
  sessionLabel: string
  clientName: string | null
  connectionId: number
  connectionName: string
  database: string | null
  sql: string
  categories: WriteCategory[]
  requestedAt: number
  expiresAt: number
}

export type AgentClientId = 'claude-code' | 'codex' | 'antigravity' | 'claude-desktop'

export type AgentClientStatus = 'not_configured' | 'configured' | 'outdated' | 'error'

export interface AgentClientState {
  id: AgentClientId
  name: string
  configPath: string
  detected: boolean
  status: AgentClientStatus
  error?: string
  manual: { kind: 'command' | 'json' | 'toml', text: string }
  canInstall: boolean
}

export interface AgentServerInfo {
  running: boolean
  serverName: string
  command: string
  args: string[]
  env: Record<string, string>
  error?: string
}
