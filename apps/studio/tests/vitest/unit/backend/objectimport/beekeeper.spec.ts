import { describe, it, expect } from 'vitest'
import path from 'path'
import Encryptor from 'simple-encryptor'
import {
  BEEKEEPER_KEYFILE_KEY,
  beekeeperDataDirCandidates,
  convertBeekeeperRows,
  readBeekeeperEncryptionKey,
} from '@/backend/lib/objectimport/beekeeper'

const key = 'a'.repeat(64)
const enc = Encryptor(key)

const folders = [
  { id: 7, name: 'EU', parentId: 3 },
  { id: 3, name: 'Prod', parentId: null },
  { id: 9, name: 'Loop', parentId: 9 },
]

const rows = [
  {
    id: 1,
    name: 'Orders',
    connectionType: 'postgresql',
    host: 'db.internal',
    port: 5433,
    username: 'app',
    defaultDatabase: 'orders',
    password: enc.encrypt('secret'),
    sshEnabled: 1,
    sshHost: 'bastion',
    sshPort: 22,
    sshMode: 'userpass',
    sshUsername: 'ubuntu',
    sshPassword: enc.encrypt('sshpw'),
    ssl: 0,
    sslRejectUnauthorized: 1,
    labelColor: 'red',
    options: '{"connectionMethod":"manual"}',
    azureAuthOptions: JSON.stringify({ azureAuthEnabled: true, tenantId: enc.encrypt('tenant') }),
    connectionFolderId: 7,
    workspaceId: -1,
    path: null,
    rememberSshPassword: 1,
  },
  { id: 2, name: 'Mongo', connectionType: 'mongodb', host: 'm' },
  { id: 3, name: 'Legacy', connectionType: 'psql', host: 'old', connectionFolderId: 42 },
]

describe('beekeeperDataDirCandidates', () => {
  it('uses the platform config directory', () => {
    expect(beekeeperDataDirCandidates('darwin', '/Users/u')[0].dir).toBe(path.join('/Users/u', 'Library', 'Application Support', 'beekeeper-studio'))
    expect(beekeeperDataDirCandidates('win32', 'C:\\u', { APPDATA: 'C:\\roaming' })[0].dir).toBe(path.join('C:\\roaming', 'beekeeper-studio'))
    const linux = beekeeperDataDirCandidates('linux', '/home/u', { XDG_CONFIG_HOME: '/cfg' }).map((c) => c.dir)
    expect(linux[0]).toBe(path.join('/cfg', 'beekeeper-studio'))
    expect(linux).toHaveLength(3)
  })
})

describe('readBeekeeperEncryptionKey', () => {
  it('decrypts the .key file', () => {
    const contents = Encryptor(BEEKEEPER_KEYFILE_KEY).encrypt({ encryptionKey: key })
    expect(readBeekeeperEncryptionKey(contents)).toBe(key)
  })

  it('returns null for garbage', () => {
    expect(readBeekeeperEncryptionKey('nope')).toBeNull()
  })
})

describe('convertBeekeeperRows', () => {
  it('converts connections, folders and secrets', () => {
    const result = convertBeekeeperRows(rows, folders, key, { includePasswords: true })

    expect(result.folders).toEqual([
      { path: '3', name: 'Prod', parentPath: null },
      { path: '7', name: 'EU', parentPath: '3' },
      { path: '9', name: 'Loop', parentPath: null },
    ])
    expect(result.warnings).toEqual(['Skipped "Mongo": unsupported connection type mongodb'])
    expect(result.connections).toHaveLength(2)

    const [orders, legacy] = result.connections
    expect(orders).toMatchObject({
      name: 'Orders',
      connectionType: 'postgresql',
      folderPath: '7',
      host: 'db.internal',
      port: 5433,
      username: 'app',
      password: 'secret',
      sshEnabled: true,
      sshMode: 'userpass',
      sshPassword: 'sshpw',
      ssl: false,
      sslRejectUnauthorized: true,
      labelColor: 'red',
      options: { connectionMethod: 'manual' },
      azureAuthOptions: { azureAuthEnabled: true, tenantId: 'tenant' },
    })
    expect(orders).not.toHaveProperty('workspaceId')
    expect(orders).not.toHaveProperty('path')
    expect(orders).not.toHaveProperty('rememberSshPassword')
    expect(orders).not.toHaveProperty('id')

    expect(legacy).toMatchObject({ connectionType: 'postgresql', folderPath: null })
  })

  it('leaves secrets out when passwords are excluded', () => {
    const [orders] = convertBeekeeperRows(rows, folders, key, { includePasswords: false }).connections
    expect(orders.password).toBeUndefined()
    expect(orders.sshPassword).toBeUndefined()
    expect(orders.azureAuthOptions).toEqual({ azureAuthEnabled: true })
  })

  it('warns when secrets cannot be decrypted', () => {
    const wrongKey = convertBeekeeperRows(rows, [], 'b'.repeat(64), { includePasswords: true })
    expect(wrongKey.warnings[0]).toBe('3 saved secret(s) could not be decrypted and were left blank')
    expect(wrongKey.connections[0].password).toBeNull()
    expect(wrongKey.connections[0].folderPath).toBeNull()

    const noKey = convertBeekeeperRows(rows, [], null, { includePasswords: true })
    expect(noKey.warnings[0]).toBe('No Beekeeper Studio encryption key found, saved passwords were left blank')
  })
})
