import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { AgentSession } from '@/common/appdb/models/AgentSession'
import platformInfo from '@/common/platform_info'
import type { RelayHello } from '@/lib/agent/types'
import { AgentRecorder } from './AgentRecorder'
import { AgentToolError, AgentTools, ToolContext } from './AgentTools'
import { SocketTransport } from './SocketTransport'
import { jsonText } from './format'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentMcpSession')

const INSTRUCTIONS = [
  'Supersedure Studio gives access to the database connections the user enabled for agents.',
  'Start with list_connections. Reads always run. Writes are split into create (INSERT), update (UPDATE, MERGE, upserts), delete (DELETE, TRUNCATE), schema (CREATE/ALTER/DROP) and other; each connection\'s rules say whether each kind is blocked, needs the user\'s approval in Supersedure Studio, or runs. A query mixing several kinds follows the strictest rule.',
  'If one Supersedure Studio server is shared across several conversations, call start_session with a short title at the start of each conversation and pass the returned session_id to the other tools.',
].join(' ')

type ToolArgs = {
  connection?: string | number
  database?: string
  schema?: string
  table?: string
  query?: string
  title?: string
  session_id?: number
}

type ToolHandler = (args: ToolArgs, extra: { signal?: AbortSignal }) => Promise<CallToolResult>

type RegisterTool = (name: string, config: Record<string, unknown>, handler: ToolHandler) => unknown

const connectionArg = z.union([z.string(), z.number()]).describe('Connection id or name, from list_connections')
const sessionArg = z.number().int().optional().describe('Optional session_id returned by start_session')
const databaseArg = z.string().optional().describe('Database to use. Defaults to the connection\'s default database')

export class AgentMcpSession {
  readonly server: McpServer
  private rootSession: AgentSession | null = null
  private rootPromise: Promise<AgentSession> | null = null
  private children = new Map<number, AgentSession>()

  constructor(
    private transport: SocketTransport,
    private hello: RelayHello,
    private tools: AgentTools,
    private recorder: AgentRecorder,
    private onClose: (session: AgentMcpSession) => void
  ) {
    this.server = new McpServer(
      { name: 'supersedure-studio', version: platformInfo.appVersion || '0.0.0' },
      { capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS }
    )
    this.registerTools()
    transport.onclose = () => this.onClose(this)
  }

  async start(): Promise<void> {
    await this.server.connect(this.transport)
  }

  async close(): Promise<void> {
    try {
      await this.server.close()
    } catch (e) {
      log.warn('Error closing MCP session', e)
    }
  }

  sessionIds(): number[] {
    return [this.rootSession?.id, ...this.children.keys()].filter((id): id is number => typeof id === 'number')
  }

  private async root(): Promise<AgentSession> {
    if (this.rootSession) return this.rootSession
    if (!this.rootPromise) {
      const client = this.server.server.getClientVersion()
      this.rootPromise = this.recorder.startSession({
        clientName: client?.name ?? null,
        clientVersion: client?.version ?? null,
        hello: this.hello,
      }).then((s) => {
        this.rootSession = s
        return s
      }).catch((e) => {
        this.rootPromise = null
        throw e
      })
    }
    return await this.rootPromise
  }

  private async context(sessionId: number | undefined, signal?: AbortSignal): Promise<ToolContext> {
    const root = await this.root()
    const child = sessionId ? this.children.get(sessionId) : null
    return { session: child ?? root, signal }
  }

  private registerTools() {
    const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    const register = (this.server.registerTool as unknown as RegisterTool).bind(this.server) as RegisterTool

    register('list_connections', {
      title: 'List connections',
      description: 'List the saved database connections that are available to agents, with their type and access level.',
      inputSchema: { session_id: sessionArg },
      annotations: readOnly,
    }, async (args, extra) => this.run(async () => {
      const ctx = await this.context(args.session_id, extra.signal)
      return await this.tools.listConnections(ctx)
    }))

    register('list_databases', {
      title: 'List databases',
      description: 'List the databases on a connection.',
      inputSchema: { connection: connectionArg, session_id: sessionArg },
      annotations: readOnly,
    }, async (args, extra) => this.run(async () => {
      const ctx = await this.context(args.session_id, extra.signal)
      return await this.tools.listDatabases(ctx, { connection: args.connection })
    }))

    register('list_tables', {
      title: 'List tables',
      description: 'List the tables and views in a database, optionally limited to one schema.',
      inputSchema: {
        connection: connectionArg,
        database: databaseArg,
        schema: z.string().optional().describe('Schema to list'),
        session_id: sessionArg,
      },
      annotations: readOnly,
    }, async (args, extra) => this.run(async () => {
      const ctx = await this.context(args.session_id, extra.signal)
      return await this.tools.listTables(ctx, { connection: args.connection, database: args.database, schema: args.schema })
    }))

    register('describe_table', {
      title: 'Describe table',
      description: 'Describe a table: columns, primary key, indexes and foreign keys.',
      inputSchema: {
        connection: connectionArg,
        table: z.string().describe('Table name'),
        database: databaseArg,
        schema: z.string().optional().describe('Schema of the table'),
        session_id: sessionArg,
      },
      annotations: readOnly,
    }, async (args, extra) => this.run(async () => {
      const ctx = await this.context(args.session_id, extra.signal)
      return await this.tools.describeTable(ctx, { connection: args.connection, table: args.table, database: args.database, schema: args.schema })
    }))

    register('run_query', {
      title: 'Run query',
      description: 'Run a query on a connection. Reads run directly. Writes are classified as create, update, delete, schema or other and follow the connection\'s rules: blocked, sent to the user for approval in Supersedure Studio, or run.',
      inputSchema: {
        connection: connectionArg,
        query: z.string().describe('The query to run (SQL, or Redis commands for Redis connections)'),
        database: databaseArg,
        session_id: sessionArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }, async (args, extra) => this.run(async () => {
      const ctx = await this.context(args.session_id, extra.signal)
      return await this.tools.runQuery(ctx, { connection: args.connection, query: args.query, database: args.database })
    }))

    register('start_session', {
      title: 'Start session',
      description: 'Start a titled session so the calls of this conversation are grouped together in Supersedure Studio. Only needed when one server is shared by several conversations.',
      inputSchema: { title: z.string().min(1).max(120).describe('Short title for the conversation') },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async (args) => this.run(async () => {
      const root = await this.root()
      const session = await this.recorder.startSession({ parent: root, title: args.title, identitySource: 'model', hello: this.hello })
      this.children.set(session.id, session)
      return { session_id: session.id }
    }))
  }

  private async run(fn: () => Promise<unknown>): Promise<CallToolResult> {
    try {
      const value = await fn()
      return { content: [{ type: 'text', text: jsonText(value) }] }
    } catch (e) {
      const message = e instanceof AgentToolError ? e.message : (e?.message ?? String(e))
      if (!(e instanceof AgentToolError)) log.error('Agent tool failed', e)
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }
}
