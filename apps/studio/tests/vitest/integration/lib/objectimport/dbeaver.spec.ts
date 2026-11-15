import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { TestOrmConnection } from '@tests/lib/TestOrmConnection'
import { ConnectionFolder } from '@/common/appdb/models/ConnectionFolder'
import { SavedConnection } from '@/common/appdb/models/saved_connection'
import { importDBeaverProject } from '@/backend/lib/objectimport/dbeaver'

const dataSources = {
  folders: { Prod: {}, 'Prod/EU': { parent: 'Prod' } },
  connections: {
    a: {
      provider: 'postgresql',
      driver: 'postgres-jdbc',
      name: 'Orders',
      folder: 'Prod/EU',
      configuration: {
        host: 'db', port: '5432', database: 'orders', user: 'app', password: 'pw',
        handlers: { ssh_tunnel: { enabled: true, properties: { host: 'jump', authType: 'PUBLIC_KEY', keyPath: '/k' } } },
      },
    },
    b: {
      provider: 'mysql',
      driver: 'mysql8',
      name: 'Shop',
      configuration: { host: 'shop', port: '3306' },
    },
  },
}

describe('importDBeaverProject', () => {
  let projectDir: string

  beforeAll(async () => {
    await TestOrmConnection.connect()
  })

  afterAll(async () => {
    await TestOrmConnection.disconnect()
  })

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbeaver-project-'))
    await fs.mkdir(path.join(projectDir, '.dbeaver'))
    await fs.writeFile(path.join(projectDir, '.dbeaver', 'data-sources.json'), JSON.stringify(dataSources))
  })

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true })
    await SavedConnection.clear()
    await ConnectionFolder.clear()
  })

  it('creates folders and connections under the chosen parent', async () => {
    const root = await ConnectionFolder.create({ name: 'From DBeaver' }).save()

    const stats = await importDBeaverProject(projectDir, root.id, { includePasswords: true })
    expect(stats).toEqual({ directories: 2, items: 2, warnings: [] })

    const prod = await ConnectionFolder.findOneByOrFail({ name: 'Prod' })
    const eu = await ConnectionFolder.findOneByOrFail({ name: 'EU' })
    expect(prod.parentId).toBe(root.id)
    expect(eu.parentId).toBe(prod.id)

    const orders = await SavedConnection.createQueryBuilder('c').addSelect('c.password').where('c.name = :n', { n: 'Orders' }).getOneOrFail()
    expect(orders.connectionFolderId).toBe(eu.id)
    expect(orders.connectionType).toBe('postgresql')
    expect(orders.port).toBe(5432)
    expect(orders.sshMode).toBe('keyfile')
    expect(orders.sshKeyfile).toBe('/k')

    const shop = await SavedConnection.findOneByOrFail({ name: 'Shop' })
    expect(shop.connectionFolderId).toBe(root.id)
  })

  it('reuses existing folders and skips connections already imported', async () => {
    await importDBeaverProject(projectDir, null, { includePasswords: true })
    const again = await importDBeaverProject(projectDir, null, { includePasswords: true })

    expect(again.directories).toBe(0)
    expect(again.items).toBe(0)
    expect(again.warnings).toHaveLength(2)
    expect(await ConnectionFolder.count()).toBe(2)
    expect(await SavedConnection.count()).toBe(2)
  })
})
