import { Dialect as IdentifierDialect } from 'sql-query-identifier'
import { IdentifyResult } from 'sql-query-identifier/lib/defines'
import { safelyIdentify } from '@/lib/db/sql_tools'
import type { ConnectionType } from '@/lib/db/types'
import type { QueryKind, WriteCategory } from './types'

export interface Classification {
  kind: QueryKind
  categories: WriteCategory[]
  statements: number
  reason: string
}

export type RedisCommandAccess = 'read' | 'write' | 'unknown'

export type RedisLineCheck = (line: string) => RedisCommandAccess

const READ_EXECUTION_TYPES = ['LISTING', 'INFORMATION']

export function identifierDialectFor(connectionType: ConnectionType): IdentifierDialect {
  switch (connectionType) {
    case 'postgresql':
    case 'cockroachdb':
    case 'greengage':
    case 'redshift':
      return 'psql'
    case 'mysql':
    case 'mariadb':
    case 'tidb':
    case 'starrocks':
      return 'mysql'
    case 'sqlite':
    case 'bedrock':
      return 'sqlite'
    case 'sqlserver':
      return 'mssql'
    case 'bigquery':
      return 'bigquery'
    default:
      return 'generic'
  }
}

interface LexRules {
  backslashEscapes: boolean
  hashComments: boolean
  dashNeedsSpace: boolean
  backticks: boolean
  dollarQuotes: boolean
  nestedComments: boolean
  escapeStringPrefix: boolean
  tripleQuotes: boolean
  executableComments: boolean
}

function lexRules(dialect: IdentifierDialect): LexRules {
  const base: LexRules = {
    backslashEscapes: false,
    hashComments: false,
    dashNeedsSpace: false,
    backticks: false,
    dollarQuotes: false,
    nestedComments: false,
    escapeStringPrefix: false,
    tripleQuotes: false,
    executableComments: false,
  }
  switch (dialect) {
    case 'psql':
      return { ...base, dollarQuotes: true, nestedComments: true, escapeStringPrefix: true }
    case 'mysql':
      return { ...base, backslashEscapes: true, hashComments: true, dashNeedsSpace: true, backticks: true, executableComments: true }
    case 'bigquery':
      return { ...base, backslashEscapes: true, hashComments: true, backticks: true, tripleQuotes: true }
    case 'sqlite':
      return { ...base, backticks: true }
    default:
      return base
  }
}

export interface SqlScan {
  text: string
  complete: boolean
  executableComment: boolean
}

export function scanSql(sql: string, dialect: IdentifierDialect = 'generic'): SqlScan {
  const rules = lexRules(dialect)
  let out = ''
  let complete = true
  let executableComment = false
  let i = 0
  const lineEnd = (from: number) => {
    const end = sql.indexOf('\n', from)
    return end === -1 ? sql.length : end
  }
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    const prev = sql[i - 1] ?? ''
    if (ch === '-' && next === '-' && (!rules.dashNeedsSpace || i + 2 >= sql.length || /\s/.test(sql[i + 2]))) {
      i = lineEnd(i)
      out += ' '
      continue
    }
    if (rules.hashComments && ch === '#') {
      i = lineEnd(i)
      out += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      if (rules.executableComments && (sql[i + 2] === '!' || (sql[i + 2] === 'M' && sql[i + 3] === '!'))) {
        executableComment = true
      }
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--
          j += 2
        } else if (rules.nestedComments && sql[j] === '/' && sql[j + 1] === '*') {
          depth++
          j += 2
        } else {
          j++
        }
      }
      if (depth > 0) complete = false
      i = j
      out += ' '
      continue
    }
    if (rules.tripleQuotes && (ch === "'" || ch === '"') && next === ch && sql[i + 2] === ch) {
      const close = ch.repeat(3)
      let j = i + 3
      while (j < sql.length && !sql.startsWith(close, j)) j += sql[j] === '\\' ? 2 : 1
      if (j >= sql.length) complete = false
      i = j + 3
      out += ' '
      continue
    }
    const quoted = ch === "'" || ch === '"' || (rules.backticks && ch === '`')
    if (quoted) {
      const escapeString = rules.escapeStringPrefix && ch === "'" && /[eE]/.test(prev) && !/[\w$]/.test(sql[i - 2] ?? '')
      const backslashes = ch !== '`' && (rules.backslashEscapes || escapeString)
      let j = i + 1
      let closed = false
      while (j < sql.length) {
        if (backslashes && sql[j] === '\\') {
          j += 2
          continue
        }
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          closed = true
          break
        }
        j++
      }
      if (!closed) complete = false
      i = j + 1
      out += ' '
      continue
    }
    if (rules.dollarQuotes && ch === '$' && !/[\w$]/.test(prev)) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        if (end === -1) complete = false
        i = end === -1 ? sql.length : end + tag[0].length
        out += ' '
        continue
      }
    }
    out += ch
    i++
  }
  return { text: out, complete, executableComment }
}

export function stripSqlLiterals(sql: string, dialect: IdentifierDialect = 'generic'): string {
  return scanSql(sql, dialect).text
}

const DML_KEYWORDS: Record<string, WriteCategory[]> = {
  insert: ['create'],
  update: ['update'],
  delete: ['delete'],
  merge: ['create', 'update', 'delete'],
}

const DATA_TYPES: Record<string, WriteCategory[]> = {
  INSERT: ['create'],
  UPDATE: ['update'],
  DELETE: ['delete'],
  TRUNCATE: ['delete'],
  MERGE: ['create', 'update', 'delete'],
  SELECT_INTO: ['schema'],
}

function keywordCategories(text: string): WriteCategory[] {
  const found = new Set<WriteCategory>()
  for (const match of text.matchAll(/\b(insert|update|delete|merge)\b/gi)) {
    for (const c of DML_KEYWORDS[match[1].toLowerCase()]) found.add(c)
  }
  return Array.from(found)
}

function isUpsert(text: string): boolean {
  return /\bon\s+conflict\b[\s\S]*\bdo\s+update\b/i.test(text) || /\bon\s+duplicate\s+key\s+update\b/i.test(text)
}

interface StatementResult {
  categories: WriteCategory[]
  reason?: string
}

function categorizeStatement(statement: IdentifyResult, dialect: IdentifierDialect): StatementResult {
  const type = statement.type ?? 'UNKNOWN'
  const executionType = statement.executionType?.toUpperCase()
  const text = stripSqlLiterals(statement.text ?? '', dialect).trim()

  if (/\bset_config"?\s*\(/i.test(statement.text ?? '')) {
    return { categories: ['other'], reason: 'set_config changes session settings' }
  }

  if (/\binto\s+(outfile|dumpfile)\b/i.test(text)) {
    return { categories: ['other'], reason: 'SELECT INTO a file' }
  }

  if (READ_EXECUTION_TYPES.includes(executionType)) {
    if (/^explain\b/i.test(text) && /\banaly[sz]e\b/i.test(text)) {
      const inner = keywordCategories(text.replace(/^explain\b/i, ''))
      if (inner.length) return { categories: inner, reason: 'EXPLAIN ANALYZE executes the statement' }
    }
    if (/^with\b/i.test(text) && /\(\s*(insert|update|delete|merge)\b/i.test(text)) {
      return { categories: keywordCategories(text), reason: 'data-modifying CTE' }
    }
    return { categories: [] }
  }

  if (type === 'INSERT') {
    return { categories: isUpsert(text) ? ['create', 'update'] : ['create'], reason: isUpsert(text) ? 'upsert' : 'INSERT statement' }
  }
  if (DATA_TYPES[type]) {
    return { categories: DATA_TYPES[type], reason: `${type.replace('_', ' ')} statement` }
  }
  if (/^(CREATE|ALTER|DROP)_/.test(type)) {
    return { categories: ['schema'], reason: `${type.replace('_', ' ')} statement` }
  }
  if (type === 'UNKNOWN' && /^replace\s+into\b/i.test(text)) {
    return { categories: ['create', 'update'], reason: 'REPLACE statement' }
  }
  if (type === 'UNKNOWN' && /^(rename|comment\s+on)\b/i.test(text)) {
    return { categories: ['schema'], reason: 'schema statement' }
  }
  return { categories: ['other'], reason: `${type.replace('_', ' ')} statement` }
}

function result(categories: Set<WriteCategory>, statements: number, reason: string): Classification {
  const list = Array.from(categories)
  return { kind: list.length ? 'write' : 'read', categories: list, statements, reason }
}

export function classifySql(sql: string, dialect: IdentifierDialect): Classification {
  if (!sql || !sql.trim()) {
    return result(new Set(['other']), 0, 'empty query')
  }
  const { queries, error } = safelyIdentify(sql, { dialect })
  if (error) {
    return result(new Set(['other']), queries.length, 'query could not be parsed')
  }
  if (!queries.length) {
    return result(new Set(['other']), 0, 'no statements found')
  }
  const scan = scanSql(sql, dialect)
  if (!scan.complete) {
    return result(new Set(['other']), queries.length, 'unterminated string or comment')
  }
  if (scan.executableComment) {
    return result(new Set(['other']), queries.length, 'executable comment')
  }
  const categories = new Set<WriteCategory>()
  const reasons: string[] = []
  for (const statement of queries) {
    const statementResult = categorizeStatement(statement, dialect)
    statementResult.categories.forEach((c) => categories.add(c))
    if (statementResult.categories.length && statementResult.reason) reasons.push(statementResult.reason)
  }
  return result(categories, queries.length, reasons.length ? Array.from(new Set(reasons)).join(', ') : 'read-only statements')
}

const REDIS_DELETE_COMMANDS = new Set([
  'del', 'unlink', 'flushdb', 'flushall', 'hdel', 'srem', 'zrem', 'zremrangebyscore', 'zremrangebyrank', 'zremrangebylex',
  'lrem', 'ltrim', 'lpop', 'rpop', 'spop', 'zpopmin', 'zpopmax', 'bzpopmin', 'bzpopmax', 'blpop', 'brpop', 'getdel',
  'xdel', 'xtrim',
])

const REDIS_OTHER_COMMANDS = new Set([
  'config', 'eval', 'evalsha', 'evalsha_ro', 'eval_ro', 'fcall', 'function', 'script', 'module', 'acl', 'debug',
  'shutdown', 'save', 'bgsave', 'bgrewriteaof', 'replicaof', 'slaveof', 'cluster', 'failover', 'migrate', 'restore',
  'swapdb', 'move', 'select', 'client', 'multi', 'exec',
])

export function classifyRedis(commands: string, checkLine?: RedisLineCheck): Classification {
  const lines = (commands ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (!lines.length) {
    return result(new Set(['other']), 0, 'empty command')
  }
  const categories = new Set<WriteCategory>()
  const reasons: string[] = []
  for (const line of lines) {
    const name = line.split(/\s+/)[0].toLowerCase()
    const access = checkLine ? checkLine(line) : 'unknown'
    if (access === 'read') continue
    if (access === 'unknown' || REDIS_OTHER_COMMANDS.has(name)) {
      categories.add('other')
    } else if (REDIS_DELETE_COMMANDS.has(name)) {
      categories.add('delete')
    } else {
      categories.add('create')
      categories.add('update')
    }
    reasons.push(`${name.toUpperCase()} command`)
  }
  return result(categories, lines.length, reasons.length ? Array.from(new Set(reasons)).join(', ') : 'read-only commands')
}

export function classifyQuery(
  text: string,
  connectionType: ConnectionType,
  options: { redisCommandAccess?: RedisLineCheck } = {}
): Classification {
  if (connectionType === 'redis') {
    return classifyRedis(text, options.redisCommandAccess)
  }
  return classifySql(text, identifierDialectFor(connectionType))
}
