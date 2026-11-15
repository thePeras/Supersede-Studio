import {
  AgentAccess,
  AgentOptions,
  AgentPreset,
  AgentRules,
  CategoryRule,
  NormalizedAgentOptions,
  PolicyDecision,
  WriteCategory,
} from './types'
import type { ConnectionType } from '@/lib/db/types'

export const WRITE_CATEGORIES: WriteCategory[] = ['create', 'update', 'delete', 'schema', 'other']

const RULES: CategoryRule[] = ['block', 'ask', 'allow']

export const categoryLabels: Record<WriteCategory, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  schema: 'Schema changes',
  other: 'Other',
}

export const categoryHints: Record<WriteCategory, string> = {
  create: 'INSERT, REPLACE',
  update: 'UPDATE, MERGE, upserts',
  delete: 'DELETE, TRUNCATE',
  schema: 'CREATE, ALTER, DROP',
  other: 'GRANT, CALL, SET, PRAGMA',
}

export const ruleLabels: Record<CategoryRule, string> = {
  block: 'Block',
  ask: 'Ask',
  allow: 'Allow',
}

export const presetLabels: Record<AgentPreset, string> = {
  read: 'Read only',
  approve_writes: 'Ask for writes',
  full: 'Full access',
  custom: 'Custom',
}


const READ_ONLY_SESSION_TYPES: ConnectionType[] = ['sqlite', 'postgresql', 'cockroachdb', 'greengage', 'mysql', 'mariadb']

export function presetRules(preset: AgentAccess): AgentRules {
  switch (preset) {
    case 'full':
      return { create: 'allow', update: 'allow', delete: 'allow', schema: 'allow', other: 'ask' }
    case 'approve_writes':
      return { create: 'ask', update: 'ask', delete: 'ask', schema: 'ask', other: 'ask' }
    default:
      return { create: 'block', update: 'block', delete: 'block', schema: 'block', other: 'block' }
  }
}

export interface RuleRow {
  key: string
  label: string
  hint: string
  icon: WriteCategory
  categories: WriteCategory[]
}

export function readRuleHint(connectionType?: ConnectionType): string {
  return connectionType === 'redis' ? 'GET, SCAN, HGETALL' : 'SELECT, SHOW, EXPLAIN'
}

export function ruleRows(connectionType?: ConnectionType): RuleRow[] {
  if (connectionType === 'redis') {
    return [
      { key: 'write', label: 'Write', hint: 'SET, HSET, LPUSH, EXPIRE', icon: 'update', categories: ['create', 'update'] },
      { key: 'delete', label: 'Delete', hint: 'DEL, UNLINK, LPOP, FLUSHDB', icon: 'delete', categories: ['delete'] },
      { key: 'other', label: 'Other', hint: 'EVAL, CONFIG, SELECT', icon: 'other', categories: ['other'] },
    ]
  }
  return WRITE_CATEGORIES.map((c) => ({ key: c, label: categoryLabels[c], hint: categoryHints[c], icon: c, categories: [c] }))
}

export function strictestRule(rules: AgentRules, categories: WriteCategory[]): CategoryRule {
  return RULES.find((rule) => categories.some((c) => rules[c] === rule)) ?? 'block'
}

export function allowedRules(_category: WriteCategory): CategoryRule[] {
  return RULES
}

export function normalizeRules(rules: Partial<AgentRules> | null | undefined, fallback: AgentRules): AgentRules {
  const result = { ...fallback }
  for (const category of WRITE_CATEGORIES) {
    const value = rules?.[category]
    if (value && allowedRules(category).includes(value)) {
      result[category] = value
    }
  }
  return result
}

export function normalizeAgentOptions(options?: AgentOptions | null): NormalizedAgentOptions {
  const preset: AgentAccess = ['read', 'approve_writes', 'full'].includes(options?.access) ? options.access : 'read'
  return {
    enabled: !!options?.enabled,
    rules: normalizeRules(options?.rules, presetRules(preset)),
  }
}

export interface AgentConnectionLike {
  readOnlyMode?: boolean
  agentOptions?: AgentOptions | null
}

export function isAgentEnabled(connection: AgentConnectionLike): boolean {
  return normalizeAgentOptions(connection?.agentOptions).enabled
}

export function effectiveRules(connection: AgentConnectionLike): AgentRules {
  if (connection?.readOnlyMode) return presetRules('read')
  return normalizeAgentOptions(connection?.agentOptions).rules
}

export function matchingPreset(rules: AgentRules): AgentPreset {
  const presets: AgentAccess[] = ['read', 'approve_writes', 'full']
  return presets.find((p) => WRITE_CATEGORIES.every((c) => presetRules(p)[c] === rules[c])) ?? 'custom'
}

export function isReadOnly(rules: AgentRules): boolean {
  return WRITE_CATEGORIES.every((c) => rules[c] === 'block')
}

export function readOnlyEnforcement(connectionType: ConnectionType): 'database' | 'app' {
  return READ_ONLY_SESSION_TYPES.includes(connectionType) ? 'database' : 'app'
}

export interface Decision {
  decision: PolicyDecision
  blocked: WriteCategory[]
  asking: WriteCategory[]
}

export function decide(rules: AgentRules, categories: WriteCategory[]): Decision {
  const unique = Array.from(new Set(categories))
  const blocked = unique.filter((c) => rules[c] === 'block')
  const asking = unique.filter((c) => rules[c] === 'ask')
  if (blocked.length) return { decision: 'reject', blocked, asking }
  if (asking.length) return { decision: 'approve', blocked, asking }
  return { decision: 'run', blocked, asking }
}

export function describeCategories(categories: WriteCategory[]): string {
  const labels = categories.map((c) => categoryLabels[c].toLowerCase())
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
