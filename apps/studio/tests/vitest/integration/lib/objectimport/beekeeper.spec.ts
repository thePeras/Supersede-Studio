import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import Database from 'better-sqlite3'
import Encryptor from 'simple-encryptor'
import { TestOrmConnection } from '@tests/lib/TestOrmConnection'
import { ConnectionFolder } from '@/common/appdb/models/ConnectionFolder'
import { SavedConnection } from '@/common/appdb/models/saved_connection'
import { BEEKEEPER_KEYFILE_KEY, findBeekeeperDataDirs, importBeekeeperDataDir } from '@/backend/lib/objectimport/beekeeper'

const key = 'c'.repeat(64)

async function createBeekeeperDir(dir: string) {
  await fs.writeFile(path.join(dir, '.key'), Encryptor(BEEKEEPER_KEYFILE_KEY).encrypt({ encryptionKey: key }))
  const db = new Database(path.join(dir, 'app.db'))
  db.exec(`
    CREATE TABLE connection_folder (id INTEGER PRIMARY KEY, name VARCHAR(255), parentId INTEGER);
    CREATE TABLE saved_connection (
      id INTEGER PRIMARY KEY, name VARCHAR, connectionType VARCHAR, host VARCHAR, port INTEGER,
      username VARCHAR, password VARCHAR, sshEnabled BOOLEAN, sshMode VARCHAR, sshHost VARCHAR,
      sshKeyfile VARCHAR, options TEXT, connectionFolderId INTEGER, workspaceId INTEGER
    );
  `)
  db.prepare('INSERT INTO connection_folder VALUES (?, ?, ?)').run(1, 'Prod', null)
  db.prepare('INSERT INTO connection_folder VALUES (?, ?, ?)').run(2, 'EU', 1)
  const insert = db.prepare(`INSERT INTO saved_connection
    (name, connectionType, host, port, username, password, sshEnabled, sshMode, sshHost, sshKeyfile, options, connectionFolderId, workspaceId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, -1)`)
  insert.run('Orders', 'postgresql', 'db', 5432, 'app', Encryptor(key).encrypt('pw'), 1, 'keyfile', 'jump', '/k', '{"connectionMethod":"manual"}', 2)
  insert.run('Shop', 'mysql', 'shop', 3306, null, null, 0, 'agent', null, null, '{}', null)
  db.close()
}

describe('importBeekeeperDataDir', () => {
  let dataDir: string

  beforeAll(async () => {
    await TestOrmConnection.connect()
  })

  afterAll(async () => {
    await TestOrmConnection.disconnect()
  })

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beekeeper-data-'))
    await createBeekeeperDir(dataDir)
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
    await SavedConnection.clear()
    await ConnectionFolder.clear()
  })

  it('detects the data folder', async () => {
    const found = await findBeekeeperDataDirs(dataDir)
    expect(found).toEqual([{ name: path.basename(dataDir), dir: dataDir, connectionCount: 2 }])
  })

  it('creates folders and connections under the chosen parent', async () => {
    const root = await ConnectionFolder.create({ name: 'From Beekeeper' }).save()

    const stats = await importBeekeeperDataDir(dataDir, root.id, { includePasswords: true })
    expect(stats).toEqual({ directories: 2, items: 2, warnings: [] })

    const prod = await ConnectionFolder.findOneByOrFail({ name: 'Prod' })
    const eu = await ConnectionFolder.findOneByOrFail({ name: 'EU' })
    expect(prod.parentId).toBe(root.id)
    expect(eu.parentId).toBe(prod.id)

    const orders = await SavedConnection.createQueryBuilder('c').addSelect('c.password').where('c.name = :n', { n: 'Orders' }).getOneOrFail()
    expect(orders.connectionFolderId).toBe(eu.id)
    expect(orders.password).toBe('pw')
    expect(orders.sshEnabled).toBe(true)
    expect(orders.sshMode).toBe('keyfile')
    expect(orders.sshKeyfile).toBe('/k')

    const shop = await SavedConnection.findOneByOrFail({ name: 'Shop' })
    expect(shop.connectionFolderId).toBe(root.id)
    expect(shop.connectionType).toBe('mysql')
  })

  it('reuses existing folders and skips connections already imported', async () => {
    await importBeekeeperDataDir(dataDir, null, { includePasswords: true })
    const again = await importBeekeeperDataDir(dataDir, null, { includePasswords: true })

    expect(again.directories).toBe(0)
    expect(again.items).toBe(0)
    expect(again.warnings).toHaveLength(2)
    expect(await SavedConnection.count()).toBe(2)
  })
})
