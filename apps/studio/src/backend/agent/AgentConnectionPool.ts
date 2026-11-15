import os from 'os'
import { SavedConnection } from '@/common/appdb/models/saved_connection'
import { openDatabaseConnection } from '@/backend/lib/openConnection'
import { BasicDatabaseClient } from '@/lib/db/clients/BasicDatabaseClient'
import { IDbConnectionPublicServer } from '@/lib/db/serverTypes'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentConnectionPool')

export type PoolMode = 'ro' | 'rw'

export const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

interface Entry {
  key: string
  connectionId: number
  stamp: string
  server: IDbConnectionPublicServer | null
  defaultDatabase: string
  clients: Map<string, BasicDatabaseClient<any, any>>
  opening: Map<string, Promise<BasicDatabaseClient<any, any>>>
  serverOpening: Promise<void> | null
  lastUsed: number
  inUse: number
}

function stampFor(config: SavedConnection): string {
  return `${config.version ?? 0}:${new Date(config.updatedAt ?? 0).getTime()}`
}

function withReadOnly(config: SavedConnection, readOnly: boolean): SavedConnection {
  const clone = Object.assign(Object.create(Object.getPrototypeOf(config)), config) as SavedConnection & { readOnlySession?: boolean }
  clone.readOnlyMode = readOnly
  clone.readOnlySession = readOnly
  return clone
}

export class AgentConnectionPool {
  private entries = new Map<string, Entry>()
  private timer: NodeJS.Timeout | null = null

  constructor(private idleTimeoutMs = IDLE_TIMEOUT_MS, private onChange?: () => void) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.timer.unref?.()
  }

  async withClient<T>(
    config: SavedConnection,
    database: string | null | undefined,
    mode: PoolMode,
    fn: (client: BasicDatabaseClient<any, any>) => Promise<T>
  ): Promise<T> {
    const entry = this.entryFor(config, mode)
    entry.inUse++
    entry.lastUsed = Date.now()
    try {
      const client = await this.clientFor(entry, config, mode, database)
      return await fn(client)
    } finally {
      entry.inUse--
      entry.lastUsed = Date.now()
    }
  }

  async closeAll(): Promise<void> {
    for (const entry of Array.from(this.entries.values())) {
      this.close(entry)
    }
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  size(): number {
    return this.entries.size
  }

  openConnectionIds(): number[] {
    const ids = new Set<number>()
    for (const entry of this.entries.values()) {
      if (entry.server) ids.add(entry.connectionId)
    }
    return Array.from(ids)
  }

  private changed(): void {
    try {
      this.onChange?.()
    } catch (e) {
      log.warn('Error notifying agent connection change', e)
    }
  }

  private entryFor(config: SavedConnection, mode: PoolMode): Entry {
    const key = `${config.id}:${mode}`
    const stamp = stampFor(config)
    const existing = this.entries.get(key)
    if (existing && existing.stamp === stamp) return existing
    if (existing) {
      if (existing.inUse === 0) {
        this.close(existing)
      } else {
        this.entries.delete(key)
        const stale = existing
        setTimeout(() => this.closeWhenIdle(stale), 1000).unref?.()
      }
    }
    const entry: Entry = {
      key,
      connectionId: config.id,
      stamp,
      server: null,
      defaultDatabase: config.defaultDatabase || '',
      clients: new Map(),
      opening: new Map(),
      serverOpening: null,
      lastUsed: Date.now(),
      inUse: 0,
    }
    this.entries.set(key, entry)
    return entry
  }

  private async clientFor(entry: Entry, config: SavedConnection, mode: PoolMode, database?: string | null): Promise<BasicDatabaseClient<any, any>> {
    const dbKey = database || entry.defaultDatabase

    if (!entry.server) {
      if (!entry.serverOpening) {
        entry.serverOpening = (async () => {
          const opened = await openDatabaseConnection(withReadOnly(config, mode === 'ro'), os.userInfo().username, {
            database: dbKey || undefined,
          })
          entry.server = opened.server
          entry.clients.set(dbKey, opened.connection)
          this.changed()
        })()
      }
      try {
        await entry.serverOpening
      } finally {
        entry.serverOpening = null
      }
    }

    const cached = entry.clients.get(dbKey)
    if (cached) return cached
    const opening = entry.opening.get(dbKey)
    if (opening) return await opening

    const server = entry.server
    const promise = (async () => {
      let client = server.db(dbKey)
      if (!client) {
        client = server.createConnection(dbKey)
        try {
          await client.connect()
        } catch (e) {
          server.destroyConnection(dbKey)
          throw e
        }
        client.connectionType = config.connectionType
      }
      entry.clients.set(dbKey, client)
      return client
    })()

    entry.opening.set(dbKey, promise)
    try {
      return await promise
    } finally {
      entry.opening.delete(dbKey)
    }
  }

  private sweep(): void {
    const now = Date.now()
    for (const entry of Array.from(this.entries.values())) {
      if (entry.inUse === 0 && now - entry.lastUsed > this.idleTimeoutMs) {
        this.close(entry)
      }
    }
  }

  private closeWhenIdle(entry: Entry): void {
    if (entry.inUse === 0) {
      this.disconnect(entry)
    } else {
      setTimeout(() => this.closeWhenIdle(entry), 1000).unref?.()
    }
  }

  private close(entry: Entry): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    this.disconnect(entry)
  }

  private disconnect(entry: Entry): void {
    const wasOpen = !!entry.server
    try {
      entry.server?.disconnect()
    } catch (e) {
      log.warn('Error closing agent connection', e)
    }
    entry.server = null
    entry.clients.clear()
    if (wasOpen) this.changed()
  }
}
