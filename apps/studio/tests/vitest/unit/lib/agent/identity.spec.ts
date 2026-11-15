import { describe, it, expect } from 'vitest'
import { clientDisplayName, resolveSessionLabel } from '@/lib/agent/identity'

describe('resolveSessionLabel', () => {
  it('uses the Conductor workspace name', () => {
    expect(resolveSessionLabel({
      clientName: 'claude-code',
      cwd: '/Users/me/conductor/workspaces/repo/feature-x',
      env: { CONDUCTOR_WORKSPACE_NAME: 'feature-x' },
    })).toBe('feature-x')
  })

  it('falls back to the Conductor workspace path', () => {
    expect(resolveSessionLabel({ env: { CONDUCTOR_WORKSPACE_PATH: '/Users/me/conductor/workspaces/repo/fix-ssh' } })).toBe('fix-ssh')
  })

  it('falls back to the cwd folder', () => {
    expect(resolveSessionLabel({ clientName: 'claude-code', cwd: '/Users/me/src/supersedure-studio' })).toBe('supersedure-studio')
    expect(resolveSessionLabel({ clientName: 'codex', cwd: 'C:\\Users\\me\\repo' })).toBe('repo')
  })

  it('falls back to the client name', () => {
    expect(resolveSessionLabel({ clientName: 'claude-code' })).toBe('Claude Code')
    expect(resolveSessionLabel({ clientName: 'claude-ai' })).toBe('Claude Desktop')
  })
})

describe('clientDisplayName', () => {
  it('maps known clients and keeps unknown names', () => {
    expect(clientDisplayName('codex-mcp-client')).toBe('Codex')
    expect(clientDisplayName('cursor-vscode')).toBe('Cursor')
    expect(clientDisplayName('my-agent')).toBe('my-agent')
    expect(clientDisplayName(null)).toBe('Unknown client')
  })
})
