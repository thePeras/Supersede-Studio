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
  command: '/Applications/Supersedure Studio.app/Contents/MacOS/Supersedure Studio',
  args: ['/Users/me/Library/Application Support/supersedure-studio/agent/mcp-relay.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

describe('JSON configs', () => {
  it('creates a config when the file does not exist', () => {
    const text = upsertJsonServer(null, 'supersedure-studio', entry)
    expect(JSON.parse(text)).toEqual({ mcpServers: { 'supersedure-studio': entry } })
  })

  it('keeps other servers and settings', () => {
    const existing = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } })
    const parsed = JSON.parse(upsertJsonServer(existing, 'supersedure-studio', entry))
    expect(parsed.theme).toBe('dark')
    expect(parsed.mcpServers.other).toEqual({ command: 'x' })
    expect(parsed.mcpServers['supersedure-studio']).toEqual(entry)
  })

  it('refuses to edit a file that is not valid JSON', () => {
    expect(() => upsertJsonServer('{ broken', 'supersedure-studio', entry)).toThrow(ConfigParseError)
  })

  it('reads and removes the entry', () => {
    const text = upsertJsonServer('{}', 'supersedure-studio', entry)
    expect(jsonServerEntry(text, 'supersedure-studio')).toEqual(entry)
    const removed = removeJsonServer(text, 'supersedure-studio')
    expect(jsonServerEntry(removed, 'supersedure-studio')).toBeNull()
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
    const text = upsertTomlServer(existing, 'supersedure-studio', entry)
    expect(text).toContain('model = "gpt-5"')
    expect(text).toContain('[mcp_servers.other]')
    expect(text).toContain('[[profiles]]')
    expect(tomlServerEntry(text, 'supersedure-studio')).toEqual({ command: entry.command, args: entry.args })
  })

  it('replaces an existing section instead of duplicating it', () => {
    const once = upsertTomlServer(existing, 'supersedure-studio', entry)
    const twice = upsertTomlServer(once, 'supersedure-studio', { ...entry, command: '/new/path' })
    expect(twice.match(/\[mcp_servers\.supersedure-studio\]/g)).toHaveLength(1)
    expect(tomlServerEntry(twice, 'supersedure-studio').command).toBe('/new/path')
  })

  it('removes the section and its subtables only', () => {
    const withSubtable = upsertTomlServer(existing, 'supersedure-studio', entry) + '\n[mcp_servers.supersedure-studio.env]\nFOO = "1"\n\n[after]\nkey = 1\n'
    const removed = removeTomlServer(withSubtable, 'supersedure-studio')
    expect(removed).not.toContain('supersedure-studio')
    expect(removed).toContain('[mcp_servers.other]')
    expect(removed).toContain('[[profiles]]')
    expect(removed).toContain('[after]')
  })

  it('escapes Windows paths', () => {
    const text = upsertTomlServer('', 'supersedure-studio', { ...entry, command: 'C:\\Program Files\\S\\S.exe' })
    expect(tomlServerEntry(text, 'supersedure-studio').command).toBe('C:\\Program Files\\S\\S.exe')
  })

  it('returns null when the section is missing', () => {
    expect(tomlServerEntry(existing, 'supersedure-studio')).toBeNull()
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
    expect(claudeCodeArgs('supersedure-studio', entry)).toEqual([
      'mcp', 'add', 'supersedure-studio', '--scope', 'user', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', entry.command, ...entry.args,
    ])
  })

  it('quotes paths with spaces for the manual command', () => {
    expect(claudeCodeCommand('supersedure-studio', entry)).toContain("'/Applications/Supersedure Studio.app/Contents/MacOS/Supersedure Studio'")
  })
})
