import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { GenericContainer, StartedTestContainer } from 'testcontainers'
import { openDatabaseConnection, OpenedConnection } from '@/backend/lib/openConnection'

const dbtimeout = 180000

const cases = [
  {
    name: 'PostgreSQL',
    image: 'postgres:11',
    port: 5432,
    env: { POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' },
    connectionType: 'postgresql',
    username: 'postgres',
    readOnlyError: /read-only transaction/i,
  },
  {
    name: 'MariaDB',
    image: 'mariadb',
    port: 3306,
    env: { MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'test' },
    connectionType: 'mariadb',
    username: 'root',
    readOnlyError: /READ ONLY transaction/i,
  },
]

describe.each(cases)('$name agent read-only session', (c) => {
  vi.setConfig({ testTimeout: dbtimeout, hookTimeout: dbtimeout })

  let container: StartedTestContainer
  const opened: OpenedConnection[] = []

  async function open(readOnlySession: boolean) {
    const config: any = {
      connectionType: c.connectionType,
      host: container.getHost(),
      port: container.getMappedPort(c.port),
      username: c.username,
      password: 'test',
      defaultDatabase: 'test',
      readOnlyMode: false,
      readOnlySession,
    }
    const connection = await openDatabaseConnection(config, 'test', { database: 'test', settings: {} as any })
    opened.push(connection)
    return connection.connection
  }

  beforeAll(async () => {
    container = await new GenericContainer(c.image)
      .withEnvironment(c.env)
      .withExposedPorts(c.port)
      .withStartupTimeout(dbtimeout)
      .start()
    let setup
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        setup = await open(false)
        break
      } catch {
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
    await setup.executeQuery('create table agent_items (id int)')
  })

  afterAll(async () => {
    for (const o of opened) {
      try { o.server.disconnect() } catch { continue }
    }
    await container?.stop()
  })

  it('refuses writes at the database level, even when the app-level check is bypassed', async () => {
    const client = await open(true)
    await expect(client.executeQuery('insert into agent_items values (1)', { overrideReadonly: true })).rejects.toThrow(c.readOnlyError)
    await expect(client.executeQuery('create table agent_other (id int)', { overrideReadonly: true })).rejects.toThrow(c.readOnlyError)
    const rows = await client.executeQuery('select count(*) as n from agent_items')
    expect(Number(Object.values(rows[0].rows[0])[0])).toBe(0)
  })

  it('keeps every pooled connection read-only', async () => {
    const client = await open(true)
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => client.executeQuery(`insert into agent_items values (${i})`, { overrideReadonly: true }))
    )
    expect(attempts.every((a) => a.status === 'rejected')).toBe(true)
  })

  it('leaves normal connections writable', async () => {
    const client = await open(false)
    await client.executeQuery('insert into agent_items values (42)')
    const rows = await client.executeQuery('select count(*) as n from agent_items')
    expect(Number(Object.values(rows[0].rows[0])[0])).toBe(1)
  })
})
