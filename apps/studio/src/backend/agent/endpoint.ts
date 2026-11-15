import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import platformInfo from '@/common/platform_info'
import type { AgentServerInfo } from '@/lib/agent/types'

const MAX_UNIX_SOCKET_PATH = 100

export function agentDirectory(): string {
  return path.resolve(platformInfo.userDirectory, platformInfo.isDevelopment ? 'agent-dev' : 'agent')
}

export function agentServerName(): string {
  return platformInfo.isDevelopment ? 'supersedure-studio-dev' : 'supersedure-studio'
}

export function relayPath(): string {
  return path.join(agentDirectory(), 'mcp-relay.js')
}

export function endpointPath(): string {
  return path.join(agentDirectory(), 'endpoint.json')
}

export function socketPathFor(dir: string, platform: NodeJS.Platform = process.platform): string {
  const hash = crypto.createHash('sha1').update(dir).digest('hex').slice(0, 12)
  if (platform === 'win32') {
    return `\\\\.\\pipe\\supersedure-studio-agent-${hash}`
  }
  const candidate = path.join(dir, 'agent.sock')
  if (Buffer.byteLength(candidate) <= MAX_UNIX_SOCKET_PATH) return candidate
  return path.join(os.tmpdir(), `supersedure-agent-${hash}.sock`)
}

export function serverCommand(): Pick<AgentServerInfo, 'serverName' | 'command' | 'args' | 'env'> {
  return {
    serverName: agentServerName(),
    command: platformInfo.execPath,
    args: [relayPath()],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

export function prepareAgentDirectory(relaySource: string): void {
  const dir = agentDirectory()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = relayPath()
  const source = fs.readFileSync(relaySource)
  const current = fs.existsSync(target) ? fs.readFileSync(target) : null
  if (!current || !current.equals(source)) {
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, source, { mode: 0o644 })
    fs.renameSync(tmp, target)
  }
}

export function writeEndpoint(socketPath: string, token: string): void {
  const file = endpointPath()
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ socketPath, token, pid: process.pid }), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function removeEndpoint(token: string): void {
  try {
    const file = endpointPath()
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed.token === token) fs.unlinkSync(file)
  } catch {
    return
  }
}
