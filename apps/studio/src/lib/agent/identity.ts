export interface SessionLabelInput {
  clientName?: string | null
  cwd?: string | null
  env?: Record<string, string>
}

const clientLabels: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude Desktop',
  'codex-mcp-client': 'Codex',
  codex: 'Codex',
  antigravity: 'Antigravity',
  'gemini-cli-mcp-client': 'Gemini CLI',
  cursor: 'Cursor',
  'cursor-vscode': 'Cursor',
}

export const RELAY_ENV_ALLOWLIST = [
  'CONDUCTOR_WORKSPACE_NAME',
  'CONDUCTOR_WORKSPACE_PATH',
]

export function clientDisplayName(clientName?: string | null): string {
  if (!clientName) return 'Unknown client'
  const key = clientName.toLowerCase()
  if (clientLabels[key]) return clientLabels[key]
  const match = Object.keys(clientLabels).find((k) => key.includes(k))
  return match ? clientLabels[match] : clientName
}

function basename(path?: string | null): string | null {
  if (!path) return null
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

export function resolveSessionLabel(input: SessionLabelInput): string {
  const env = input.env ?? {}
  return env.CONDUCTOR_WORKSPACE_NAME
    || basename(env.CONDUCTOR_WORKSPACE_PATH)
    || basename(input.cwd)
    || clientDisplayName(input.clientName)
}
