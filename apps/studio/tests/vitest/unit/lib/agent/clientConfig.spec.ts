import { describe, it, expect } from 'vitest'
import {
  claudeCodeArgs,
  claudeCodeCommand,
  ConfigParseError,
  entryMatches,
  jsonServerEntry,
  removeJsonServer,
  removeTomlServer,
  tomlServerEntry,
  upsertJsonServer,
  upsertTomlServer,
} from '@/lib/agent/clientConfig'

const entry = {
  command: '/Applications/Supersede Studio.app/Contents/MacOS/Supersede Studio',
  args: ['/Users/me/Library/Application Support/supersede-studio/agent/mcp-relay.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

describe('JSON configs', () => {
  it('creates a config when the file does not exist', () => {
    const text = upsertJsonServer(null, 'supersede-studio', entry)
    expect(JSON.parse(text)).toEqual({ mcpServers: { 'supersede-studio': entry } })
  })

  it('keeps other servers and settings', () => {
    const existing = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } })
    const parsed = JSON.parse(upsertJsonServer(existing, 'supersede-studio', entry))
    expect(parsed.theme).toBe('dark')
    expect(parsed.mcpServers.other).toEqual({ command: 'x' })
    expect(parsed.mcpServers['supersede-studio']).toEqual(entry)
  })

  it('refuses to edit a file that is not valid JSON', () => {
    expect(() => upsertJsonServer('{ broken', 'supersede-studio', entry)).toThrow(ConfigParseError)
  })

  it('reads and removes the entry', () => {
    const text = upsertJsonServer('{}', 'supersede-studio', entry)
    expect(jsonServerEntry(text, 'supersede-studio')).toEqual(entry)
    const removed = removeJsonServer(text, 'supersede-studio')
    expect(jsonServerEntry(removed, 'supersede-studio')).toBeNull()
  })
})

describe('TOML configs', () => {
  const existing = [
    'model = "gpt-5"',
    '',
    '[mcp_servers.other]',
    'command = "other"',
    '',
    '[[profiles]]',
    'name = "x"',
    '',
  ].join('\n')

  it('adds a section and reads it back', () => {
    const text = upsertTomlServer(existing, 'supersede-studio', entry)
    expect(text).toContain('model = "gpt-5"')
    expect(text).toContain('[mcp_servers.other]')
    expect(text).toContain('[[profiles]]')
    expect(tomlServerEntry(text, 'supersede-studio')).toEqual({ command: entry.command, args: entry.args })
  })

  it('replaces an existing section instead of duplicating it', () => {
    const once = upsertTomlServer(existing, 'supersede-studio', entry)
    const twice = upsertTomlServer(once, 'supersede-studio', { ...entry, command: '/new/path' })
    expect(twice.match(/\[mcp_servers\.supersede-studio\]/g)).toHaveLength(1)
    expect(tomlServerEntry(twice, 'supersede-studio').command).toBe('/new/path')
  })

  it('removes the section and its subtables only', () => {
    const withSubtable = upsertTomlServer(existing, 'supersede-studio', entry) + '\n[mcp_servers.supersede-studio.env]\nFOO = "1"\n\n[after]\nkey = 1\n'
    const removed = removeTomlServer(withSubtable, 'supersede-studio')
    expect(removed).not.toContain('supersede-studio')
    expect(removed).toContain('[mcp_servers.other]')
    expect(removed).toContain('[[profiles]]')
    expect(removed).toContain('[after]')
  })

  it('escapes Windows paths', () => {
    const text = upsertTomlServer('', 'supersede-studio', { ...entry, command: 'C:\\Program Files\\S\\S.exe' })
    expect(tomlServerEntry(text, 'supersede-studio').command).toBe('C:\\Program Files\\S\\S.exe')
  })

  it('returns null when the section is missing', () => {
    expect(tomlServerEntry(existing, 'supersede-studio')).toBeNull()
  })
})

describe('entryMatches', () => {
  it('compares command and args', () => {
    expect(entryMatches(entry, entry)).toBe(true)
    expect(entryMatches({ ...entry, command: '/old' }, entry)).toBe(false)
    expect(entryMatches({ ...entry, args: [] }, entry)).toBe(false)
    expect(entryMatches(null, entry)).toBe(false)
  })
})

describe('Claude Code command', () => {
  it('passes env and the command after the separator', () => {
    expect(claudeCodeArgs('supersede-studio', entry)).toEqual([
      'mcp', 'add', 'supersede-studio', '--scope', 'user', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', entry.command, ...entry.args,
    ])
  })

  it('quotes paths with spaces for the manual command', () => {
    expect(claudeCodeCommand('supersede-studio', entry)).toContain("'/Applications/Supersede Studio.app/Contents/MacOS/Supersede Studio'")
  })
})
