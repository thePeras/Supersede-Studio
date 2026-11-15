import { SavedConnection } from '@/common/appdb/models/saved_connection'
import { AgentSession } from '@/common/appdb/models/AgentSession'
import bksConfig from '@/common/bksConfig'
import { classifyQuery, Classification } from '@/lib/agent/classify'
import { categoryLabels, decide, describeCategories, effectiveRules, isAgentEnabled, matchingPreset, presetLabels, readOnlyEnforcement, ruleLabels } from '@/lib/agent/policy'
import type { AgentPreset, AgentRules, CallDecision, CallStatus } from '@/lib/agent/types'
import { clientDisplayName } from '@/lib/agent/identity'
import { redisCommandAccess } from '@/lib/db/clients/redis'
import { AgentConnectionPool, PoolMode } from './AgentConnectionPool'
import { AgentApprovals } from './AgentApprovals'
import { AgentRecorder } from './AgentRecorder'
import { formatResults } from './format'

export class AgentToolError extends Error {
  constructor(message: string, public status: CallStatus = 'error', public decision: CallDecision = 'auto') {
    super(message)
  }
}

export interface ToolContext {
  session: AgentSession
  signal?: AbortSignal
}

const FILE_DATABASE_TYPES = ['sqlite', 'bedrock']

const PIN_LOCKED_MESSAGE = 'Agent access is unavailable while the PIN lock is enabled in Supersede Studio.'

function pinLocked(): boolean {
  return bksConfig.security?.lockMode === 'pin'
}

export interface ConnectionSummary {
  id: number
  name: string
  type: string
  access: AgentPreset
  accessLabel: string
  rules: AgentRules
  readOnlyEnforcement: 'database' | 'app'
  defaultDatabase: string | null
}

export class AgentTools {
  constructor(
    private pool: AgentConnectionPool,
    private approvals: AgentApprovals,
    private recorder: AgentRecorder
  ) {}

  async listConnections(ctx: ToolContext): Promise<ConnectionSummary[]> {
    if (pinLocked()) {
      await this.recorder.recordCall({ session: ctx.session, tool: 'list_connections', input: {}, decision: 'blocked', status: 'rejected', error: PIN_LOCKED_MESSAGE })
      throw new AgentToolError(PIN_LOCKED_MESSAGE, 'rejected', 'blocked')
    }
    return await this.track(ctx, 'list_connections', {}, null, null, async () => {
      const all = await SavedConnection.find({ order: { name: 'ASC' } })
      return { value: all.filter(isAgentEnabled).map(summarize) }
    })
  }

  async listDatabases(ctx: ToolContext, input: { connection: string | number }): Promise<string[]> {
    const config = await this.resolveConnection(ctx, 'list_databases', input)
    return await this.track(ctx, 'list_databases', input, config, null, async () => {
      const value = await this.pool.withClient(config, null, 'ro', (client) => client.listDatabases())
      return { value, rowCount: value.length }
    })
  }

  async listTables(ctx: ToolContext, input: { connection: string | number, database?: string, schema?: string }) {
    const config = await this.resolveConnection(ctx, 'list_tables', input)
    const database = await this.resolveDatabase(ctx, 'list_tables', input, config, input.database)
    return await this.track(ctx, 'list_tables', input, config, database, async () => {
      const value = await this.pool.withClient(config, database, 'ro', async (client) => {
        const filter = { schema: input.schema ?? null }
        const tables = await client.listTables(filter)
        const views = await optional(() => client.listViews(filter), [])
        return [
          ...tables.map((t) => ({ schema: t.schema ?? null, name: t.name, type: t.entityType ?? 'table' })),
          ...views.map((t) => ({ schema: t.schema ?? null, name: t.name, type: t.entityType ?? 'view' })),
        ]
      })
      return { value, rowCount: value.length }
    })
  }

  async describeTable(ctx: ToolContext, input: { connection: string | number, table: string, database?: string, schema?: string }) {
    const config = await this.resolveConnection(ctx, 'describe_table', input)
    const database = await this.resolveDatabase(ctx, 'describe_table', input, config, input.database)
    return await this.track(ctx, 'describe_table', input, config, database, async () => {
      const value = await this.pool.withClient(config, database, 'ro', async (client) => {
        const schema = input.schema || undefined
        const columns = await client.listTableColumns(input.table, schema)
        const primaryKey = await optional(() => client.getPrimaryKeys(input.table, schema), [])
        const indexes = await optional(() => client.listTableIndexes(input.table, schema), [])
        const foreignKeys = await optional(() => client.getOutgoingKeys(input.table, schema), [])
        return {
          table: input.table,
          schema: schema ?? null,
          columns,
          primaryKey: primaryKey.map((k) => k.columnName),
          indexes: indexes.map((i) => ({ name: i.name, unique: i.unique, primary: i.primary, columns: i.columns?.map((c: any) => c.name ?? c) })),
          foreignKeys,
        }
      })
      return { value, rowCount: value.columns?.length ?? 0 }
    })
  }

  async runQuery(ctx: ToolContext, input: { connection: string | number, query: string, database?: string }) {
    const config = await this.resolveConnection(ctx, 'run_query', input, input.query)
    const database = await this.resolveDatabase(ctx, 'run_query', input, config, input.database, input.query)
    const rules = effectiveRules(config)
    const classification = this.classify(config, input.query)
    const { decision: policy, blocked } = decide(rules, classification.categories)
    const base = {
      session: ctx.session, tool: 'run_query', input, connectionId: config.id, connectionName: config.name,
      database, sql: input.query, kind: classification.kind, categories: classification.categories,
    }

    if (policy === 'reject') {
      const settings = blocked.map((c) => `${categoryLabels[c]}: ${ruleLabels[rules[c]]}`).join(', ')
      const message = config.readOnlyMode
        ? `Blocked: "${config.name}" is in Read Only Mode, so agents can only run reads. This query is a ${describeCategories(classification.categories)} (${classification.reason}).`
        : `Blocked: this query is a ${describeCategories(classification.categories)} (${classification.reason}), and "${config.name}" does not allow it for agents (${settings}).`
      await this.recorder.recordCall({ ...base, decision: 'blocked', status: 'rejected', error: message })
      throw new AgentToolError(message, 'rejected', 'blocked')
    }

    let decisionTaken: CallDecision = 'auto'
    if (policy === 'approve') {
      const outcome = await this.approvals.request({
        sessionLabel: ctx.session.title || ctx.session.label,
        clientName: clientDisplayName(ctx.session.clientName),
        connectionId: config.id,
        connectionName: config.name,
        database: database !== (config.defaultDatabase || null) ? database : null,
        sql: input.query,
        categories: classification.categories,
      }, ctx.signal)
      if (outcome !== 'approved') {
        const decision: CallDecision = outcome === 'timeout' ? 'timeout' : 'denied'
        const message = outcome === 'timeout'
          ? 'No response to the approval request in Supersede Studio. The query was not run.'
          : 'The query was denied in Supersede Studio.'
        await this.recorder.recordCall({ ...base, decision, status: 'rejected', error: message })
        throw new AgentToolError(message, 'rejected', decision)
      }
      decisionTaken = 'approved'
    }

    const mode: PoolMode = classification.kind === 'read' ? 'ro' : 'rw'
    const started = Date.now()
    try {
      const results = await this.pool.withClient(config, database, mode, (client) => client.executeQuery(input.query))
      const formatted = formatResults(results)
      await this.recorder.recordCall({ ...base, decision: decisionTaken, status: 'ok', rowCount: formatted.totalRows, durationMs: Date.now() - started })
      return {
        connection: config.name,
        database,
        kind: classification.kind,
        categories: classification.categories,
        results: formatted.results,
      }
    } catch (e) {
      const message = this.connectionErrorMessage(config, e)
      await this.recorder.recordCall({ ...base, decision: decisionTaken, status: 'error', error: message, durationMs: Date.now() - started })
      throw new AgentToolError(message, 'error', decisionTaken)
    }
  }

  classify(config: SavedConnection, query: string): Classification {
    return classifyQuery(query, config.connectionType, { redisCommandAccess })
  }

  private async resolveConnection(ctx: ToolContext, tool: string, input: { connection: string | number }, sql?: string): Promise<SavedConnection> {
    const config = await findConnection(input.connection)
    let problem: string | null = null
    if (!config || !isAgentEnabled(config)) {
      problem = `No connection "${input.connection}" is available to agents. Use list_connections to see the connections with agent access enabled.`
    } else if (pinLocked()) {
      problem = PIN_LOCKED_MESSAGE
    } else if (config.connectionType === 'cockroachdb' && config.options?.jwtAuthEnabled && !config.password) {
      problem = `"${config.name}" uses JWT authentication, which needs a token entered in Supersede Studio. Agent access is not supported for it.`
    }
    if (problem) {
      await this.recorder.recordCall({
        session: ctx.session,
        tool,
        input,
        connectionId: config && isAgentEnabled(config) ? config.id : null,
        connectionName: config && isAgentEnabled(config) ? config.name : null,
        sql: sql ?? null,
        decision: 'blocked',
        status: 'rejected',
        error: problem,
      })
      throw new AgentToolError(problem, 'rejected', 'blocked')
    }
    return config
  }

  private async resolveDatabase(
    ctx: ToolContext,
    tool: string,
    input: unknown,
    config: SavedConnection,
    database?: string | null,
    sql?: string
  ): Promise<string | null> {
    const fallback = config.defaultDatabase || null
    if (!database || database === fallback) return fallback
    let problem: string | null = null
    if (FILE_DATABASE_TYPES.includes(config.connectionType)) {
      problem = `"${config.name}" is a file database. The database argument is not supported for it.`
    } else {
      let available: string[] = []
      try {
        available = await this.pool.withClient(config, null, 'ro', (client) => client.listDatabases())
      } catch (e) {
        problem = this.connectionErrorMessage(config, e)
      }
      if (!problem && !available.map(String).includes(String(database))) {
        problem = `Database "${database}" was not found on "${config.name}". Use list_databases to see the available databases.`
      }
    }
    if (problem) {
      await this.recorder.recordCall({
        session: ctx.session, tool, input,
        connectionId: config.id, connectionName: config.name, database: String(database),
        sql: sql ?? null, decision: 'blocked', status: 'rejected', error: problem,
      })
      throw new AgentToolError(problem, 'rejected', 'blocked')
    }
    return String(database)
  }

  private async track<T>(
    ctx: ToolContext,
    tool: string,
    input: unknown,
    config: SavedConnection | null,
    database: string | null,
    fn: () => Promise<{ value: T, rowCount?: number }>
  ): Promise<T> {
    const started = Date.now()
    try {
      const { value, rowCount } = await fn()
      await this.recorder.recordCall({
        session: ctx.session, tool, input,
        connectionId: config?.id ?? null, connectionName: config?.name ?? null, database,
        decision: 'auto', status: 'ok', rowCount: rowCount ?? null, durationMs: Date.now() - started,
      })
      return value
    } catch (e) {
      const message = config ? this.connectionErrorMessage(config, e) : (e?.message ?? String(e))
      await this.recorder.recordCall({
        session: ctx.session, tool, input,
        connectionId: config?.id ?? null, connectionName: config?.name ?? null, database,
        decision: 'auto', status: 'error', error: message, durationMs: Date.now() - started,
      })
      throw new AgentToolError(message)
    }
  }

  private connectionErrorMessage(config: SavedConnection, e: any): string {
    const message = e?.message ?? String(e)
    if (config.rememberPassword === false) {
      return `${message} (Passwords for "${config.name}" are not saved. Agent access needs saved credentials.)`
    }
    return message
  }
}

export function summarize(config: SavedConnection): ConnectionSummary {
  const rules = effectiveRules(config)
  const access = matchingPreset(rules)
  return {
    id: config.id,
    name: config.name,
    type: config.connectionType,
    access,
    accessLabel: presetLabels[access],
    rules,
    readOnlyEnforcement: readOnlyEnforcement(config.connectionType),
    defaultDatabase: config.defaultDatabase || null,
  }
}

async function findConnection(ref: string | number): Promise<SavedConnection | null> {
  if (ref === null || ref === undefined || ref === '') return null
  const asNumber = typeof ref === 'number' ? ref : (/^\d+$/.test(String(ref).trim()) ? Number(ref) : null)
  if (asNumber !== null) {
    const byId = await SavedConnection.findOneBy({ id: asNumber })
    if (byId) return byId
  }
  const all = await SavedConnection.find()
  const needle = String(ref).trim().toLowerCase()
  const matches = all.filter((c) => (c.name ?? '').trim().toLowerCase() === needle)
  const enabled = matches.filter(isAgentEnabled)
  return enabled[0] ?? matches[0] ?? null
}

async function optional<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}
