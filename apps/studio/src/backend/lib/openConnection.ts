import { IGroupedUserSettings, UserSetting } from '@/common/appdb/models/user_setting'
import { IConnection } from '@/common/interfaces/IConnection'
import ConnectionProvider from '@/backend/lib/connection-provider'
import { BasicDatabaseClient } from '@/lib/db/clients/BasicDatabaseClient'
import { IDbConnectionPublicServer } from '@/lib/db/serverTypes'
import rawLog from '@bksLogger'

const log = rawLog.scope('openConnection')

export interface OpenedConnection {
  server: IDbConnectionPublicServer
  connection: BasicDatabaseClient<any, any>
}

export async function openDatabaseConnection(
  config: IConnection,
  osUser: string,
  options: { database?: string, signal?: AbortSignal, settings?: IGroupedUserSettings } = {}
): Promise<OpenedConnection> {
  const settings = options.settings ?? await UserSetting.all()
  const server = ConnectionProvider.for(config, osUser, settings)
  const connection = server.createConnection(options.database)
  try {
    await connection.connect(options.signal)
  } catch (e) {
    // A failed connect can still have opened sockets, pools or an ssh tunnel.
    // Nothing else holds a reference to `server` yet, so tear it down here or
    // it leaks for every failed attempt.
    try {
      server.disconnect()
    } catch (disconnectError) {
      log.error('Error cleaning up after a failed connection', disconnectError)
    }
    throw e
  }
  // HACK (@day): this is because of type fuckery, need to actually just recreate the object but I'm lazy rn and it's late
  connection.connectionType = config.connectionType ?? (config as any)._connectionType
  return { server, connection }
}
