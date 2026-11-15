import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import esbuild from 'esbuild'
import Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { TestOrmConnection } from '@tests/lib/TestOrmConnection'
import { SavedConnection } from '@/common/appdb/models/saved_connection'
import { AgentCall } from '@/common/appdb/models/AgentCall'
import { AgentSession } from '@/common/appdb/models/AgentSession'
import { UsedQuery } from '@/common/appdb/models/used_query'
import { AgentApprovals } from '@/backend/agent/AgentApprovals'
import { AgentConnectionPool } from '@/backend/agent/AgentConnectionPool'
import { AgentMcpSession } from '@/backend/agent/AgentMcpSession'
import { AgentRecorder } from '@/backend/agent/AgentRecorder'
import { AgentServer } from '@/backend/agent/AgentServer'
import { AgentTools } from '@/backend/agent/AgentTools'
import { socketPathFor } from '@/backend/agent/endpoint'
import bksConfig from '@/common/bksConfig'

type Decision = boolean | null

let dir: string
let relayFile: string
let dbFile: string
let socketPath: string
let token: string
let server: AgentServer | null = null
let pool: AgentConnectionPool
let approvals: AgentApprovals
let recorder: AgentRecorder
const liveSessions: AgentMcpSession[] = []
let nextDecision: Decision = true
const approvalRequests: any[] = []

async function startServer() {
  recorder = new AgentRecorder(() => undefined)
  pool = new AgentConnectionPool()
  approvals = new AgentApprovals({
    requested: (request) => {
      approvalRequests.push(request)
      if (nextDecision !== null) setImmediate(() => approvals.decide(request.id, nextDecision))
    },
    resolved: () => undefined,
  }, 2000)
  const tools = new AgentTools(pool, approvals, recorder)
  server = new AgentServer(socketPath, token, async (transport, hello) => {
    const session = new AgentMcpSession(transport, hello, tools, recorder, (s) => {
      liveSessions.splice(liveSessions.indexOf(s), 1)
    })
    liveSessions.push(session)
    await session.start()
  })
  await server.listen()
  fs.writeFileSync(path.join(dir, 'endpoint.json'), JSON.stringify({ socketPath, token }))
}

async function stopServer() {
  await server?.close()
  server = null
  await pool?.closeAll()
}

async function connectClient(env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [relayFile],
    env: { ...process.env as Record<string, string>, ELECTRON_RUN_AS_NODE: '1', ...env },
    cwd: dir,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'claude-code', version: '9.9.9' })
  await client.connect(transport)
  return client
}

function text(result: any): string {
  return result.content.map((c: any) => c.text).join('\n')
}

async function saveConnection(name: string, agentOptions: any, extra: Partial<SavedConnection> = {}) {
  const c = new SavedConnection()
  c.connectionType = 'sqlite'
  c.defaultDatabase = dbFile
  c.name = name
  c.agentOptions = agentOptions
  Object.assign(c, extra)
  return await c.save()
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value as T
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe('Agent MCP end to end', () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bks-agent-'))
    relayFile = path.join(dir, 'mcp-relay.js')
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../../../../../src/entrypoints/mcp-relay.ts')],
      bundle: true,
      platform: 'node',
      outfile: relayFile,
      tsconfig: path.resolve(__dirname, '../../../../../tsconfig.json'),
      logLevel: 'silent',
    })
    dbFile = path.join(dir, 'target.db')
    const db = new Database(dbFile)
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO users (name) VALUES ('ada'), ('grace'), ('linus');`)
    db.close()
    socketPath = socketPathFor(dir)
    token = crypto.randomBytes(16).toString('hex')
    await TestOrmConnection.connect()
  })

  afterAll(async () => {
    await stopServer()
    await TestOrmConnection.disconnect()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await stopServer()
    await AgentCall.createQueryBuilder().delete().execute()
    await AgentSession.createQueryBuilder().delete().execute()
    await UsedQuery.createQueryBuilder().delete().execute()
    await SavedConnection.createQueryBuilder().delete().execute()
    approvalRequests.length = 0
    nextDecision = true
    await startServer()
  })

  it('lists only connections with agent access enabled', async () => {
    await saveConnection('Visible', { enabled: true, access: 'read' })
    await saveConnection('Hidden', { enabled: false, access: 'full' })
    const client = await connectClient()
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((t) => t.name).sort()).toEqual(['describe_table', 'list_connections', 'list_databases', 'list_tables', 'run_query', 'start_session'])
      const result = await client.callTool({ name: 'list_connections', arguments: {} })
      const list = JSON.parse(text(result))
      expect(list.map((c: any) => c.name)).toEqual(['Visible'])
      expect(list[0]).toMatchObject({ type: 'sqlite', access: 'read' })
      expect(JSON.stringify(list)).not.toContain('password')
    } finally {
      await client.close()
    }
  })

  it('blocks list_connections while the PIN lock is enabled', async () => {
    await saveConnection('Visible', { enabled: true, access: 'read' })
    const security = bksConfig.security as any
    const previous = security.lockMode
    security.lockMode = 'pin'
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'list_connections', arguments: {} })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/PIN lock/)
      expect(text(result)).not.toContain('Visible')
    } finally {
      security.lockMode = previous
      await client.close()
    }
    const call = await AgentCall.findOneBy({ tool: 'list_connections' })
    expect(call).toMatchObject({ decision: 'blocked', status: 'rejected' })
  })

  it('keeps recording for connected agents after the activity is cleared', async () => {
    await saveConnection('Local', { enabled: true, access: 'full' })
    const client = await connectClient()
    try {
      const started = JSON.parse(text(await client.callTool({ name: 'start_session', arguments: { title: 'Cleanup' } })))
      await client.callTool({ name: 'run_query', arguments: { connection: 'Local', query: 'select 1', session_id: started.session_id } })
      await AgentSession.save(new AgentSession().withProps({ label: 'old', identitySource: 'client', lastSeenAt: new Date() }))

      await recorder.clear(liveSessions.flatMap((s) => s.sessionIds()))
      expect(await AgentCall.count()).toBe(0)
      const remaining = (await AgentSession.find()).map((s) => s.label)
      expect(remaining).toHaveLength(2)
      expect(remaining).toContain('Cleanup')
      expect(remaining).not.toContain('old')

      const inserted = await client.callTool({ name: 'run_query', arguments: { connection: 'Local', query: "insert into users (name) values ('after-clear')", session_id: started.session_id } })
      expect(inserted.isError).toBeFalsy()
      const blocked = await client.callTool({ name: 'run_query', arguments: { connection: 'Local', query: 'drop table nope' } })
      expect(text(blocked)).not.toMatch(/FOREIGN KEY/)
    } finally {
      await client.close()
    }
    const calls = await AgentCall.find({ where: { tool: 'run_query' } })
    expect(calls).toHaveLength(2)
    const db = new Database(dbFile)
    db.prepare("delete from users where name = 'after-clear'").run()
    db.close()
  })

  it('runs reads, describes tables and records the calls with the session label', async () => {
    const conn = await saveConnection('Local', { enabled: true, access: 'read' })
    const client = await connectClient({ CONDUCTOR_WORKSPACE_NAME: 'feature-x' })
    try {
      const tables = JSON.parse(text(await client.callTool({ name: 'list_tables', arguments: { connection: 'Local' } })))
      expect(tables.map((t: any) => t.name)).toContain('users')

      const described = JSON.parse(text(await client.callTool({ name: 'describe_table', arguments: { connection: conn.id, table: 'users' } })))
      expect(described.columns.map((c: any) => c.columnName)).toEqual(['id', 'name'])
      expect(described.primaryKey).toEqual(['id'])

      const result = await client.callTool({ name: 'run_query', arguments: { connection: 'local', query: 'select name from users order by id' } })
      expect(result.isError).toBeFalsy()
      const payload = JSON.parse(text(result))
      expect(payload.kind).toBe('read')
      expect(payload.results[0].rows).toEqual([{ name: 'ada' }, { name: 'grace' }, { name: 'linus' }])
      expect(payload.results[0].truncated).toBe(false)
    } finally {
      await client.close()
    }

    const sessions = await AgentSession.find()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ clientName: 'claude-code', label: 'feature-x' })

    const calls = await AgentCall.find({ order: { id: 'ASC' } })
    expect(calls.map((c) => c.tool)).toEqual(['list_tables', 'describe_table', 'run_query'])
    expect(calls[2]).toMatchObject({ kind: 'read', decision: 'auto', status: 'ok', rowCount: 3, connectionId: conn.id })

    const history = await UsedQuery.find({ select: ['id', 'connectionId', 'agentCallId', 'agentLabel', 'numberOfRecords'] })
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ connectionId: conn.id, agentCallId: calls[2].id, agentLabel: 'Claude Code' })
  })

  it('blocks writes on read-only connections', async () => {
    await saveConnection('Readonly', { enabled: true, access: 'full' }, { readOnlyMode: true })
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'run_query', arguments: { connection: 'Readonly', query: "insert into users (name) values ('x')" } })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/Blocked/)
    } finally {
      await client.close()
    }
    const db = new Database(dbFile, { readonly: true })
    expect(db.prepare('select count(*) as n from users').get()).toEqual({ n: 3 })
    db.close()
    const call = await AgentCall.findOne({ where: { tool: 'run_query' } })
    expect(call).toMatchObject({ kind: 'write', decision: 'blocked', status: 'rejected' })
    expect(await UsedQuery.count()).toBe(0)
  })

  it('asks for approval and only runs approved writes', async () => {
    await saveConnection('Ask', { enabled: true, access: 'approve_writes' })
    const client = await connectClient()
    try {
      nextDecision = false
      const denied = await client.callTool({ name: 'run_query', arguments: { connection: 'Ask', query: "insert into users (name) values ('denied')" } })
      expect(denied.isError).toBe(true)
      expect(text(denied)).toMatch(/denied/)

      nextDecision = true
      const approved = await client.callTool({ name: 'run_query', arguments: { connection: 'Ask', query: "insert into users (name) values ('approved')" } })
      expect(approved.isError).toBeFalsy()

      nextDecision = null
      const timedOut = await client.callTool({ name: 'run_query', arguments: { connection: 'Ask', query: "insert into users (name) values ('late')" } })
      expect(timedOut.isError).toBe(true)
      expect(text(timedOut)).toMatch(/No response/)
    } finally {
      await client.close()
    }
    expect(approvalRequests).toHaveLength(3)
    expect(approvalRequests[0]).toMatchObject({ connectionName: 'Ask', clientName: 'Claude Code' })
    const db = new Database(dbFile)
    expect(db.prepare("select name from users where name in ('denied','approved','late')").all()).toEqual([{ name: 'approved' }])
    db.prepare("delete from users where name = 'approved'").run()
    db.close()
    const decisions = (await AgentCall.find({ order: { id: 'ASC' } })).map((c) => c.decision)
    expect(decisions).toEqual(['denied', 'approved', 'timeout'])
  })

  it('applies a separate rule to each kind of write', async () => {
    await saveConnection('Rules', { enabled: true, rules: { create: 'allow', update: 'ask', delete: 'block', schema: 'block', other: 'block' } })
    const client = await connectClient()
    try {
      const inserted = await client.callTool({ name: 'run_query', arguments: { connection: 'Rules', query: "insert into users (name) values ('rule-insert')" } })
      expect(inserted.isError).toBeFalsy()
      expect(JSON.parse(text(inserted)).categories).toEqual(['create'])

      const deleted = await client.callTool({ name: 'run_query', arguments: { connection: 'Rules', query: "delete from users where name = 'rule-insert'" } })
      expect(deleted.isError).toBe(true)
      expect(text(deleted)).toMatch(/Delete: Block/)

      const mixed = await client.callTool({ name: 'run_query', arguments: { connection: 'Rules', query: "insert into users (name) values ('mixed'); delete from users where name = 'rule-insert'" } })
      expect(mixed.isError).toBe(true)

      nextDecision = true
      const updated = await client.callTool({ name: 'run_query', arguments: { connection: 'Rules', query: "update users set name = 'rule-updated' where name = 'rule-insert'" } })
      expect(updated.isError).toBeFalsy()

      const schema = await client.callTool({ name: 'run_query', arguments: { connection: 'Rules', query: 'drop table users' } })
      expect(schema.isError).toBe(true)
      expect(text(schema)).toMatch(/Schema changes: Block/)

      const listed = JSON.parse(text(await client.callTool({ name: 'list_connections', arguments: {} })))
      expect(listed[0]).toMatchObject({ access: 'custom', accessLabel: 'Custom', readOnlyEnforcement: 'database' })
    } finally {
      await client.close()
    }
    expect(approvalRequests).toHaveLength(1)
    expect(approvalRequests[0].categories).toEqual(['update'])
    const db = new Database(dbFile)
    expect(db.prepare("select name from users where name like 'rule-%' or name = 'mixed'").all()).toEqual([{ name: 'rule-updated' }])
    db.prepare("delete from users where name = 'rule-updated'").run()
    db.close()
    const calls = await AgentCall.find({ where: { tool: 'run_query' }, order: { id: 'ASC' } })
    expect(calls.map((c) => [c.categories, c.decision])).toEqual([
      ['create', 'auto'],
      ['delete', 'blocked'],
      ['create,delete', 'blocked'],
      ['update', 'approved'],
      ['schema', 'blocked'],
    ])
  })

  it('opens read connections with a read-only database session', async () => {
    const conn = await saveConnection('Session', { enabled: true, access: 'full' })
    await expect(
      pool.withClient(conn, null, 'ro', (client) => client.executeQuery("insert into users (name) values ('bypass')", { overrideReadonly: true }))
    ).rejects.toThrow(/readonly/i)
    const db = new Database(dbFile, { readonly: true })
    expect(db.prepare("select count(*) as n from users where name = 'bypass'").get()).toEqual({ n: 0 })
    db.close()
  })

  it('refuses unknown databases and file paths for file databases', async () => {
    await saveConnection('Local', { enabled: true, access: 'full' })
    const client = await connectClient()
    try {
      const result = await client.callTool({ name: 'run_query', arguments: { connection: 'Local', query: 'select 1', database: '/etc/hosts' } })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/file database/)
    } finally {
      await client.close()
    }
  })

  it('groups calls under a model-started session', async () => {
    await saveConnection('Local', { enabled: true, access: 'read' })
    const client = await connectClient()
    try {
      const started = JSON.parse(text(await client.callTool({ name: 'start_session', arguments: { title: 'Slow orders' } })))
      await client.callTool({ name: 'run_query', arguments: { connection: 'Local', query: 'select 1', session_id: started.session_id } })
    } finally {
      await client.close()
    }
    const child = await AgentSession.findOneBy({ title: 'Slow orders' })
    expect(child).toMatchObject({ identitySource: 'model', label: 'Slow orders' })
    expect(child.parentSessionId).not.toBeNull()
    const call = await AgentCall.findOneBy({ tool: 'run_query' })
    expect(call.sessionId).toBe(child.id)
  })

  it('answers offline when the app is not running and connects once it starts', async () => {
    await saveConnection('Local', { enabled: true, access: 'read' })
    await stopServer()
    const client = await connectClient()
    try {
      expect(client.getInstructions()).toMatch(/not running/)
      expect((await client.listTools()).tools).toEqual([])
      const offline = await client.callTool({ name: 'list_connections', arguments: {} }).catch((e) => e)
      expect(String(offline?.message ?? text(offline))).toMatch(/not running/)

      let changed = false
      client.setNotificationHandler(
        (await import('@modelcontextprotocol/sdk/types.js')).ToolListChangedNotificationSchema,
        async () => { changed = true }
      )
      await startServer()
      await waitFor(async () => changed)
      const tools = await client.listTools()
      expect(tools.tools.map((t) => t.name)).toContain('run_query')
      const list = JSON.parse(text(await client.callTool({ name: 'list_connections', arguments: {} })))
      expect(list.map((c: any) => c.name)).toEqual(['Local'])
    } finally {
      await client.close()
    }
  }, 30000)

  it('rejects relays with the wrong token', async () => {
    fs.writeFileSync(path.join(dir, 'endpoint.json'), JSON.stringify({ socketPath, token: 'wrong' }))
    const client = await connectClient()
    try {
      expect(client.getInstructions()).toMatch(/not running/)
      expect((await client.listTools()).tools).toEqual([])
    } finally {
      await client.close()
    }
    expect(await AgentSession.count()).toBe(0)
  })
})
