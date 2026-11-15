import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import platformInfo from '@/common/platform_info'
import type { AgentClientId, AgentClientState } from '@/lib/agent/types'
import {
  claudeCodeArgs,
  claudeCodeCommand,
  ConfigParseError,
  entryMatches,
  jsonServerEntry,
  jsonSnippet,
  removeJsonServer,
  removeTomlServer,
  ServerEntry,
  tomlServerEntry,
  tomlServerSection,
  upsertJsonServer,
  upsertTomlServer,
} from '@/lib/agent/clientConfig'
import { serverCommand } from './endpoint'
import rawLog from '@bksLogger'

const log = rawLog.scope('AgentClients')

const CLI_TIMEOUT_MS = 20_000

function home(...parts: string[]): string {
  return path.resolve(platformInfo.homeDirectory, ...parts)
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function readText(file: string): string | null {
  return exists(file) ? fs.readFileSync(file, 'utf8') : null
}

function writeTextAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let mode = 0o644
  if (exists(file)) {
    mode = fs.statSync(file).mode & 0o777
    fs.copyFileSync(file, `${file}.bak`)
  }
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, { mode })
  fs.renameSync(tmp, file)
}

function expectedEntry(): { name: string, entry: ServerEntry } {
  const info = serverCommand()
  return { name: info.serverName, entry: { command: info.command, args: info.args, env: info.env } }
}

function run(file: string, args: string[]): Promise<{ stdout: string, stderr: string }> {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const isWindows = process.platform === 'win32'
  const quote = (v: string) => (isWindows && /[\s"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v)
  return new Promise((resolve, reject) => {
    execFile(quote(file), args.map(quote), {
      timeout: CLI_TIMEOUT_MS,
      shell: isWindows,
      env,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).toString().trim()))
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
      }
    })
  })
}

let claudeBinaryCache: { value: string | null, at: number } | null = null

async function findClaudeBinary(): Promise<string | null> {
  if (claudeBinaryCache && Date.now() - claudeBinaryCache.at < 60_000) return claudeBinaryCache.value
  let found: string | null = null
  const candidates = process.platform === 'win32'
    ? [home('.local', 'bin', 'claude.exe'), home('AppData', 'Roaming', 'npm', 'claude.cmd')]
    : [home('.claude', 'local', 'claude'), home('.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude']
  found = candidates.find(exists) ?? null
  if (!found) {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await run('where', ['claude'])
        found = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null
      } else {
        const shell = process.env.SHELL || '/bin/sh'
        const { stdout } = await run(shell, ['-ilc', 'command -v claude'])
        found = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/')).pop() ?? null
      }
    } catch {
      found = null
    }
  }
  claudeBinaryCache = { value: found, at: Date.now() }
  return found
}

function claudeDesktopConfigPath(): string {
  if (platformInfo.isMac) return home('Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (platformInfo.isWindows) return path.join(process.env.APPDATA || home('AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  return home('.config', 'Claude', 'claude_desktop_config.json')
}

function antigravityConfigPath(): string {
  const legacy = home('.gemini', 'antigravity', 'mcp_config.json')
  const current = home('.gemini', 'config', 'mcp_config.json')
  if (exists(legacy) && !exists(current)) return legacy
  if (exists(path.dirname(legacy)) && !exists(path.dirname(current))) return legacy
  return current
}

function antigravityDetected(): boolean {
  return exists(home('.gemini', 'antigravity')) || exists(home('.gemini', 'config', 'mcp_config.json')) || exists('/Applications/Antigravity.app')
}

function codexConfigPath(): string {
  return path.join(process.env.CODEX_HOME || home('.codex'), 'config.toml')
}

interface JsonClientDef {
  id: AgentClientId
  name: string
  configPath: () => string
  detected: () => boolean
}

const jsonClients: JsonClientDef[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    configPath: claudeDesktopConfigPath,
    detected: () => exists(path.dirname(claudeDesktopConfigPath())),
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    configPath: antigravityConfigPath,
    detected: antigravityDetected,
  },
]

function statusFor(entry: Partial<ServerEntry> | null, expected: ServerEntry): AgentClientState['status'] {
  if (!entry) return 'not_configured'
  return entryMatches(entry, expected) ? 'configured' : 'outdated'
}

async function jsonClientState(def: JsonClientDef): Promise<AgentClientState> {
  const { name, entry } = expectedEntry()
  const configPath = def.configPath()
  const state: AgentClientState = {
    id: def.id,
    name: def.name,
    configPath,
    detected: def.detected(),
    status: 'not_configured',
    manual: { kind: 'json', text: jsonSnippet(name, entry) },
    canInstall: true,
  }
  try {
    state.status = statusFor(jsonServerEntry(readText(configPath), name), entry)
  } catch (e) {
    state.status = 'error'
    state.error = e.message
    state.canInstall = false
  }
  return state
}

async function codexState(): Promise<AgentClientState> {
  const { name, entry } = expectedEntry()
  const configPath = codexConfigPath()
  return {
    id: 'codex',
    name: 'Codex',
    configPath,
    detected: exists(path.dirname(configPath)),
    status: statusFor(tomlServerEntry(readText(configPath), name), entry),
    manual: { kind: 'toml', text: tomlServerSection(name, entry) },
    canInstall: true,
  }
}

async function claudeCodeState(): Promise<AgentClientState> {
  const { name, entry } = expectedEntry()
  const configPath = home('.claude.json')
  const binary = await findClaudeBinary()
  const state: AgentClientState = {
    id: 'claude-code',
    name: 'Claude Code',
    configPath,
    detected: !!binary || exists(configPath),
    status: 'not_configured',
    manual: { kind: 'command', text: claudeCodeCommand(name, entry) },
    canInstall: !!binary,
  }
  if (!binary) state.error = 'The claude command was not found. Run the command below in a terminal.'
  try {
    state.status = statusFor(jsonServerEntry(readText(configPath), name), entry)
  } catch (e) {
    state.status = 'error'
    state.error = e instanceof ConfigParseError ? `Could not read ${configPath}.` : e.message
  }
  return state
}

export async function listClientStates(): Promise<AgentClientState[]> {
  return await Promise.all([
    claudeCodeState(),
    codexState(),
    ...jsonClients.map(jsonClientState),
  ])
}

export async function clientState(id: AgentClientId): Promise<AgentClientState> {
  const states = await listClientStates()
  return states.find((s) => s.id === id)
}

export async function installClient(id: AgentClientId): Promise<AgentClientState> {
  const { name, entry } = expectedEntry()
  if (id === 'claude-code') {
    const binary = await findClaudeBinary()
    if (!binary) throw new Error('The claude command was not found. Run the command shown in a terminal.')
    await run(binary, ['mcp', 'remove', '--scope', 'user', name]).catch(() => undefined)
    await run(binary, claudeCodeArgs(name, entry))
  } else if (id === 'codex') {
    const file = codexConfigPath()
    writeTextAtomic(file, upsertTomlServer(readText(file), name, entry))
  } else {
    const def = jsonClients.find((c) => c.id === id)
    if (!def) throw new Error(`Unknown client ${id}`)
    const file = def.configPath()
    writeTextAtomic(file, upsertJsonServer(readText(file), name, entry))
  }
  log.info('Installed agent server for', id)
  return await clientState(id)
}

export async function removeClient(id: AgentClientId): Promise<AgentClientState> {
  const { name } = expectedEntry()
  if (id === 'claude-code') {
    const binary = await findClaudeBinary()
    if (!binary) throw new Error('The claude command was not found. Run `claude mcp remove --scope user ' + name + '` in a terminal.')
    await run(binary, ['mcp', 'remove', '--scope', 'user', name])
  } else if (id === 'codex') {
    const file = codexConfigPath()
    const text = readText(file)
    if (text !== null) writeTextAtomic(file, removeTomlServer(text, name))
  } else {
    const def = jsonClients.find((c) => c.id === id)
    if (!def) throw new Error(`Unknown client ${id}`)
    const file = def.configPath()
    const text = readText(file)
    if (text !== null) writeTextAtomic(file, removeJsonServer(text, name))
  }
  log.info('Removed agent server for', id)
  return await clientState(id)
}
