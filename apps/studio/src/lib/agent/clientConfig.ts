export interface ServerEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

export class ConfigParseError extends Error {}

function parseJsonConfig(text: string | null): Record<string, any> {
  if (text === null || !text.trim()) return {}
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new ConfigParseError(`The file is not valid JSON (${e.message}). Fix it or add the entry manually.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigParseError('The file does not contain a JSON object. Fix it or add the entry manually.')
  }
  return parsed
}

export function jsonServerEntry(text: string | null, name: string): Partial<ServerEntry> | null {
  const config = parseJsonConfig(text)
  const entry = config.mcpServers?.[name]
  return entry && typeof entry === 'object' ? entry : null
}

export function upsertJsonServer(text: string | null, name: string, entry: ServerEntry): string {
  const config = parseJsonConfig(text)
  const servers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}
  config.mcpServers = { ...servers, [name]: { command: entry.command, args: entry.args, env: entry.env } }
  return JSON.stringify(config, null, 2) + '\n'
}

export function removeJsonServer(text: string | null, name: string): string {
  const config = parseJsonConfig(text)
  if (config.mcpServers && typeof config.mcpServers === 'object') {
    delete config.mcpServers[name]
  }
  return JSON.stringify(config, null, 2) + '\n'
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value)
}

function sectionHeaders(name: string): string[] {
  return [`mcp_servers.${name}`, `mcp_servers."${name}"`, `"mcp_servers".${name}`, `"mcp_servers"."${name}"`]
}

function headerOf(line: string): string | null {
  const arrayTable = /^\s*\[\[\s*([^\][]+?)\s*\]\]\s*(#.*)?$/.exec(line)
  if (arrayTable) return `[[${arrayTable[1]}]]`
  const match = /^\s*\[\s*([^\][]+?)\s*\]\s*(#.*)?$/.exec(line)
  return match ? match[1].replace(/\s*\.\s*/g, '.') : null
}

function belongsTo(header: string, name: string): boolean {
  return sectionHeaders(name).some((h) => header === h || header.startsWith(`${h}.`))
}

export function tomlServerEntry(text: string | null, name: string): Partial<ServerEntry> | null {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  let inside = false
  let found = false
  const entry: Partial<ServerEntry> = {}
  for (const line of lines) {
    const header = headerOf(line)
    if (header !== null) {
      inside = sectionHeaders(name).includes(header)
      if (inside) found = true
      continue
    }
    if (!inside) continue
    const command = /^\s*command\s*=\s*(".*")\s*(#.*)?$/.exec(line)
    if (command) {
      try { entry.command = JSON.parse(command[1]) } catch { entry.command = command[1] }
    }
    const args = /^\s*args\s*=\s*(\[.*\])\s*(#.*)?$/.exec(line)
    if (args) {
      try { entry.args = JSON.parse(args[1]) } catch { entry.args = [] }
    }
  }
  return found ? entry : null
}

export function removeTomlServer(text: string | null, name: string): string {
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const header = headerOf(line)
    if (header !== null) skipping = belongsTo(header, name)
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n')
}

export function tomlServerSection(name: string, entry: ServerEntry): string {
  const env = Object.entries(entry.env)
    .map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`)
    .join(', ')
  return [
    `[mcp_servers.${tomlKey(name)}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(', ')}]`,
    `env = { ${env} }`,
  ].join('\n') + '\n'
}

export function upsertTomlServer(text: string | null, name: string, entry: ServerEntry): string {
  const base = removeTomlServer(text ?? '', name).replace(/\s*$/, '')
  const section = tomlServerSection(name, entry)
  return base ? `${base}\n\n${section}` : section
}

export function entryMatches(entry: Partial<ServerEntry> | null, expected: ServerEntry): boolean {
  if (!entry) return false
  const args = Array.isArray(entry.args) ? entry.args : []
  return entry.command === expected.command
    && args.length === expected.args.length
    && args.every((a, i) => a === expected.args[i])
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_\-./:=@]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

export function claudeCodeArgs(name: string, entry: ServerEntry): string[] {
  const env = Object.entries(entry.env).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  return ['mcp', 'add', name, '--scope', 'user', ...env, '--', entry.command, ...entry.args]
}

export function claudeCodeCommand(name: string, entry: ServerEntry): string {
  return ['claude', ...claudeCodeArgs(name, entry)].map(shellQuote).join(' ')
}

export function jsonSnippet(name: string, entry: ServerEntry): string {
  return JSON.stringify({ mcpServers: { [name]: { command: entry.command, args: entry.args, env: entry.env } } }, null, 2)
}
