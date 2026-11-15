import { describe, it, expect } from 'vitest'
import {
  allowedRules,
  ruleRows,
  strictestRule,
  readRuleHint,
  decide,
  describeCategories,
  effectiveRules,
  isAgentEnabled,
  isReadOnly,
  matchingPreset,
  normalizeAgentOptions,
  presetRules,
  readOnlyEnforcement,
} from '@/lib/agent/policy'

const allBlock = { create: 'block', update: 'block', delete: 'block', schema: 'block', other: 'block' }

describe('normalizeAgentOptions', () => {
  it('defaults to disabled with every write blocked', () => {
    expect(normalizeAgentOptions(undefined)).toEqual({ enabled: false, rules: allBlock })
    expect(normalizeAgentOptions({})).toEqual({ enabled: false, rules: allBlock })
  })

  it('converts the old access levels into rules', () => {
    expect(normalizeAgentOptions({ access: 'approve_writes' }).rules).toEqual(presetRules('approve_writes'))
    expect(normalizeAgentOptions({ access: 'full' }).rules).toEqual(presetRules('full'))
  })

  it('prefers explicit rules over the old access level', () => {
    const rules = normalizeAgentOptions({ access: 'full', rules: { delete: 'block' } }).rules
    expect(rules).toEqual({ ...presetRules('full'), delete: 'block' })
  })

  it('keeps allow for the other category and ignores unknown values', () => {
    const rules = normalizeAgentOptions({ rules: { other: 'allow', create: 'maybe' as any } }).rules
    expect(rules.other).toBe('allow')
    expect(rules.create).toBe('block')
  })
})

describe('presets', () => {
  it('full access still asks for unrecognized statements', () => {
    expect(presetRules('full')).toEqual({ create: 'allow', update: 'allow', delete: 'allow', schema: 'allow', other: 'ask' })
  })

  it('recognizes presets and custom rule sets', () => {
    expect(matchingPreset(presetRules('read'))).toBe('read')
    expect(matchingPreset(presetRules('approve_writes'))).toBe('approve_writes')
    expect(matchingPreset({ ...presetRules('read'), create: 'allow' })).toBe('custom')
  })

  it('offers block, ask and allow for every category', () => {
    expect(allowedRules('other')).toEqual(['block', 'ask', 'allow'])
    expect(allowedRules('create')).toEqual(['block', 'ask', 'allow'])
  })

  it('reports whether every write is blocked', () => {
    expect(isReadOnly(presetRules('read'))).toBe(true)
    expect(isReadOnly(presetRules('approve_writes'))).toBe(false)
  })
})

describe('isAgentEnabled', () => {
  it('is false unless explicitly enabled', () => {
    expect(isAgentEnabled({})).toBe(false)
    expect(isAgentEnabled({ agentOptions: { rules: { create: 'allow' } } })).toBe(false)
    expect(isAgentEnabled({ agentOptions: { enabled: true } })).toBe(true)
  })
})

describe('effectiveRules', () => {
  it('uses the configured rules', () => {
    expect(effectiveRules({ agentOptions: { enabled: true, rules: { create: 'allow' } } }).create).toBe('allow')
  })

  it('blocks every write when the connection is in Read Only Mode', () => {
    expect(effectiveRules({ readOnlyMode: true, agentOptions: { enabled: true, access: 'full' } })).toEqual(allBlock)
  })
})

describe('decide', () => {
  const rules = { create: 'allow', update: 'ask', delete: 'block', schema: 'ask', other: 'ask' } as const

  it('runs reads', () => {
    expect(decide(rules, []).decision).toBe('run')
  })

  it('applies the rule for a single category', () => {
    expect(decide(rules, ['create']).decision).toBe('run')
    expect(decide(rules, ['update']).decision).toBe('approve')
    expect(decide(rules, ['delete'])).toEqual({ decision: 'reject', blocked: ['delete'], asking: [] })
  })

  it('follows the strictest rule when a query mixes categories', () => {
    expect(decide(rules, ['create', 'update']).decision).toBe('approve')
    expect(decide(rules, ['create', 'update', 'delete'])).toEqual({ decision: 'reject', blocked: ['delete'], asking: ['update'] })
  })
})

describe('helpers', () => {
  it('describes categories in prose', () => {
    expect(describeCategories(['delete'])).toBe('delete')
    expect(describeCategories(['create', 'update', 'delete'])).toBe('create, update and delete')
  })

  it('knows which databases get a read-only session', () => {
    expect(readOnlyEnforcement('postgresql')).toBe('database')
    expect(readOnlyEnforcement('sqlite')).toBe('database')
    expect(readOnlyEnforcement('mariadb')).toBe('database')
    expect(readOnlyEnforcement('sqlserver')).toBe('app')
    expect(readOnlyEnforcement('redshift')).toBe('app')
  })
})

describe('ruleRows', () => {
  it('shows one row per category for SQL connections', () => {
    expect(ruleRows('postgresql').map((r) => r.categories)).toEqual([['create'], ['update'], ['delete'], ['schema'], ['other']])
  })

  it('groups create and update into a single write row for Redis and hides schema', () => {
    const rows = ruleRows('redis')
    expect(rows.map((r) => r.key)).toEqual(['write', 'delete', 'other'])
    expect(rows[0].categories).toEqual(['create', 'update'])
    expect(readRuleHint('redis')).toContain('GET')
  })
})

describe('strictestRule', () => {
  const rules = { create: 'allow', update: 'ask', delete: 'block', schema: 'allow', other: 'allow' } as const

  it('returns the strictest rule among the categories', () => {
    expect(strictestRule(rules, ['create', 'update'])).toBe('ask')
    expect(strictestRule(rules, ['create', 'delete'])).toBe('block')
    expect(strictestRule(rules, ['create'])).toBe('allow')
  })
})
