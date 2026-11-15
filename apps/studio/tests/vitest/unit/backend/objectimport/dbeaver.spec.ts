import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import {
  DBEAVER_CREDENTIALS_KEY,
  convertDBeaverDataSources,
  dbeaverWorkspaceCandidates,
  decryptDBeaverCredentials,
  findDBeaverProjects,
  readDBeaverProject,
} from '@/backend/lib/objectimport/dbeaver'

function encryptCredentials(obj: unknown): Buffer {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(DBEAVER_CREDENTIALS_KEY, 'hex'), iv)
  return Buffer.concat([iv, cipher.update(JSON.stringify(obj), 'utf-8'), cipher.final()])
}

const dataSources = {
  folders: {
    Prod: {},
    'Prod/EU': { parent: 'Prod' },
  },
  connections: {
    'postgres-jdbc-1': {
      provider: 'postgresql',
      driver: 'postgres-jdbc',
      name: 'Orders',
      folder: 'Prod/EU',
      'save-password': true,
      configuration: {
        host: 'db.internal',
        port: '5433',
        database: 'orders',
        type: 'prod',
        handlers: {
          ssh_tunnel: {
            type: 'TUNNEL',
            enabled: true,
            'save-password': true,
            properties: { host: 'bastion.example.com', port: 2222, authType: 'PUBLIC_KEY', keyPath: '/home/u/.ssh/id_ed25519' },
          },
          postgre_ssl: {
            enabled: true,
            properties: { 'ssl.root.cert': '/certs/ca.pem' },
          },
        },
      },
    },
    'mysql8-2': {
      provider: 'mysql',
      driver: 'mysql8',
      name: 'Shop',
      folder: 'Staging',
      'save-password': true,
      configuration: {
        host: 'shop',
        port: '3306',
        database: 'shop',
        type: 'test',
        user: 'legacy',
        password: 'legacy-pass',
        handlers: {
          ssh_tunnel: {
            enabled: true,
            properties: { host: 'jump', authType: 'PASSWORD' },
          },
        },
      },
    },
    'sqlite-3': {
      provider: 'generic',
      driver: 'sqlite_jdbc',
      name: 'Local',
      configuration: { url: 'jdbc:sqlite:/tmp/local.db', type: 'dev' },
    },
    'mssql-4': {
      provider: 'mssql',
      driver: 'microsoft',
      name: 'Reporting',
      configuration: { url: 'jdbc:sqlserver://reports:1444;databaseName=x;trustServerCertificate=false' },
    },
    'oracle-5': {
      provider: 'oracle',
      driver: 'oracle_thin',
      name: 'Legacy ERP',
      configuration: { host: 'erp' },
    },
  },
}

const credentials = {
  'postgres-jdbc-1': {
    '#connection': { user: 'app', password: 'secret' },
    'network/ssh_tunnel': { user: 'tunnel', password: 'key-pass' },
  },
  'mysql8-2': {
    'network/ssh_tunnel': { user: 'jumper', password: 'jump-pass' },
  },
}

describe('decryptDBeaverCredentials', () => {
  it('decrypts the AES-128-CBC credentials file', () => {
    expect(decryptDBeaverCredentials(encryptCredentials(credentials))).toEqual(credentials)
  })
})

describe('dbeaverWorkspaceCandidates', () => {
  it('returns per-platform workspace paths', () => {
    expect(dbeaverWorkspaceCandidates('darwin', '/Users/u', {})).toEqual([path.join('/Users/u', 'Library', 'DBeaverData', 'workspace6')])
    expect(dbeaverWorkspaceCandidates('win32', 'C:/u', { APPDATA: 'C:/u/AppData/Roaming' })[0]).toBe(path.join('C:/u/AppData/Roaming', 'DBeaverData', 'workspace6'))
    expect(dbeaverWorkspaceCandidates('linux', '/home/u', {})[0]).toBe(path.join('/home/u', '.local', 'share', 'DBeaverData', 'workspace6'))
  })
})

describe('convertDBeaverDataSources', () => {
  const result = convertDBeaverDataSources(dataSources, credentials, { includePasswords: true })
  const byName = (name: string) => result.connections.find((c) => c.name === name)

  it('builds a parent-first folder list including folders only referenced by connections', () => {
    expect(result.folders).toEqual([
      { path: 'Prod', name: 'Prod', parentPath: null },
      { path: 'Staging', name: 'Staging', parentPath: null },
      { path: 'Prod/EU', name: 'EU', parentPath: 'Prod' },
    ])
  })

  it('maps a postgres connection with SSH key and SSL', () => {
    expect(byName('Orders')).toMatchObject({
      connectionType: 'postgresql',
      folderPath: 'Prod/EU',
      host: 'db.internal',
      port: 5433,
      defaultDatabase: 'orders',
      username: 'app',
      password: 'secret',
      labelColor: 'red',
      sshEnabled: true,
      sshHost: 'bastion.example.com',
      sshPort: 2222,
      sshUsername: 'tunnel',
      sshMode: 'keyfile',
      sshKeyfile: '/home/u/.ssh/id_ed25519',
      sshKeyfilePassword: 'key-pass',
      ssl: true,
      sslCaFile: '/certs/ca.pem',
    })
  })

  it('falls back to inline legacy credentials and maps password SSH', () => {
    expect(byName('Shop')).toMatchObject({
      connectionType: 'mysql',
      username: 'legacy',
      password: 'legacy-pass',
      labelColor: 'orange',
      sshMode: 'userpass',
      sshPort: 22,
      sshUsername: 'jumper',
      sshPassword: 'jump-pass',
    })
  })

  it('reads sqlite and sql server details from the JDBC url', () => {
    expect(byName('Local')).toMatchObject({ connectionType: 'sqlite', defaultDatabase: '/tmp/local.db', labelColor: 'default' })
    expect(byName('Reporting')).toMatchObject({ connectionType: 'sqlserver', host: 'reports', port: 1444, trustServerCertificate: false })
  })

  it('skips unsupported drivers with a warning', () => {
    expect(byName('Legacy ERP')).toBeUndefined()
    expect(result.warnings).toContain('Skipped "Legacy ERP": unsupported driver oracle_thin')
  })

  it('omits passwords when includePasswords is false', () => {
    const noPw = convertDBeaverDataSources(dataSources, credentials, { includePasswords: false })
    const orders = noPw.connections.find((c) => c.name === 'Orders')
    const shop = noPw.connections.find((c) => c.name === 'Shop')
    expect(orders.password).toBeUndefined()
    expect(orders.sshKeyfilePassword).toBeNull()
    expect(orders.username).toBe('app')
    expect(shop.password).toBeUndefined()
    expect(shop.sshPassword).toBeNull()
  })
})

describe('project discovery', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dbeaver-'))
    const dir = path.join(workspace, 'General', '.dbeaver')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'data-sources.json'), JSON.stringify(dataSources))
    await fs.writeFile(path.join(dir, 'credentials-config.json'), encryptCredentials(credentials))
    await fs.mkdir(path.join(workspace, 'Empty'))
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('finds projects in a workspace directory', async () => {
    expect(await findDBeaverProjects(workspace)).toEqual([
      { name: 'General', dir: path.join(workspace, 'General'), connectionCount: 5 },
    ])
  })

  it('accepts a project directory directly', async () => {
    const projects = await findDBeaverProjects(path.join(workspace, 'General'))
    expect(projects.map((p) => p.name)).toEqual(['General'])
  })

  it('reads and decrypts a project from disk', async () => {
    const result = await readDBeaverProject(path.join(workspace, 'General'), { includePasswords: true })
    expect(result.connections.find((c) => c.name === 'Orders')?.password).toBe('secret')
  })
})
