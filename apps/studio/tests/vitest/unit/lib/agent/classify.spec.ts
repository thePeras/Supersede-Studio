import { describe, it, expect } from 'vitest'
import { classifyQuery, classifyRedis, identifierDialectFor, stripSqlLiterals } from '@/lib/agent/classify'

describe('classifyQuery', () => {
  it.each([
    ['select * from users', 'postgresql'],
    ['SELECT 1; SELECT 2;', 'postgresql'],
    ['show tables', 'mysql'],
    ['explain select * from users', 'postgresql'],
    ['explain analyze select * from users', 'postgresql'],
    ['describe users', 'mysql'],
    ['select * from users where note = \'please delete me\'', 'postgresql'],
    ['-- delete from users\nselect 1', 'postgresql'],
    ['select updated_at, created_by from t', 'postgresql'],
  ] as const)('treats %s as a read', (sql, type) => {
    expect(classifyQuery(sql, type).kind).toBe('read')
  })

  it.each([
    ['insert into users values (1)', 'postgresql'],
    ['update users set name = 1', 'mysql'],
    ['delete from users', 'sqlite'],
    ['drop table users', 'sqlserver'],
    ['create table x (id int)', 'postgresql'],
    ['truncate users', 'postgresql'],
    ['select 1; delete from users', 'postgresql'],
    ['select * into new_table from users', 'postgresql'],
    ['explain analyze delete from users', 'postgresql'],
    ['with gone as (delete from users returning *) select * from gone', 'postgresql'],
    ['select * from users into outfile \'/tmp/x\'', 'mysql'],
    ['vacuum', 'sqlite'],
    ['pragma journal_mode = wal', 'sqlite'],
    ['', 'postgresql'],
    ['   ', 'postgresql'],
  ] as const)('treats %s as a write', (sql, type) => {
    expect(classifyQuery(sql, type).kind).toBe('write')
  })

  it('counts statements', () => {
    expect(classifyQuery('select 1; select 2', 'postgresql').statements).toBe(2)
  })

  it('explains why a query is a write', () => {
    expect(classifyQuery('delete from users', 'postgresql').reason).toMatch(/DELETE/)
  })
})

describe('write categories', () => {
  it.each([
    ['insert into users values (1)', 'postgresql', ['create']],
    ["insert into users (id) values (1) on conflict (id) do update set name = 'x'", 'postgresql', ['create', 'update']],
    ['insert into users (id) values (1) on duplicate key update name = 2', 'mysql', ['create', 'update']],
    ['replace into users values (1)', 'mysql', ['create', 'update']],
    ['update users set name = 1', 'mysql', ['update']],
    ['merge into t using s on t.id = s.id when matched then update set x = 1', 'sqlserver', ['create', 'update', 'delete']],
    ['delete from users', 'sqlite', ['delete']],
    ['truncate users', 'postgresql', ['delete']],
    ['create table x (id int)', 'postgresql', ['schema']],
    ['alter table x add column y int', 'postgresql', ['schema']],
    ['drop table users', 'sqlserver', ['schema']],
    ['create index i on x (id)', 'postgresql', ['schema']],
    ['select * into new_table from users', 'postgresql', ['schema']],
    ['grant select on users to bob', 'postgresql', ['other']],
    ['set default_transaction_read_only = off', 'postgresql', ['other']],
    ['pragma journal_mode = wal', 'sqlite', ['other']],
    ['explain analyze delete from users', 'postgresql', ['delete']],
    ['with gone as (delete from users returning *) select * from gone', 'postgresql', ['delete']],
    ['select * from users into outfile \'/tmp/x\'', 'mysql', ['other']],
    ['', 'postgresql', ['other']],
  ] as const)('%s → %j', (sql, type, categories) => {
    const result = classifyQuery(sql, type)
    expect(result.kind).toBe('write')
    expect([...result.categories].sort()).toEqual([...categories].sort())
  })

  it('collects every category in a batch', () => {
    const result = classifyQuery("insert into a values (1); delete from b; select 1", 'postgresql')
    expect([...result.categories].sort()).toEqual(['create', 'delete'])
    expect(result.statements).toBe(3)
  })

  it('has no categories for reads', () => {
    expect(classifyQuery('select 1', 'postgresql')).toMatchObject({ kind: 'read', categories: [] })
  })
})

describe('classifyRedis', () => {
  const access = (line: string) => {
    const name = line.split(' ')[0].toLowerCase()
    if (['get', 'hgetall', 'keys'].includes(name)) return 'read' as const
    if (['set', 'hset', 'del', 'flushdb', 'config', 'expire'].includes(name)) return 'write' as const
    return 'unknown' as const
  }

  it('treats known read-only commands as reads', () => {
    expect(classifyRedis('GET a\nHGETALL b', access)).toMatchObject({ kind: 'read', categories: [] })
  })

  it('treats SET-like commands as create and update', () => {
    expect([...classifyRedis('SET a 1', access).categories].sort()).toEqual(['create', 'update'])
    expect([...classifyRedis('EXPIRE a 10', access).categories].sort()).toEqual(['create', 'update'])
  })

  it('treats DEL and FLUSHDB as deletes', () => {
    expect(classifyRedis('DEL a\nFLUSHDB', access).categories).toEqual(['delete'])
  })

  it('treats admin and unknown commands as other', () => {
    expect(classifyRedis('CONFIG SET x 1', access).categories).toEqual(['other'])
    expect(classifyRedis('MYCOMMAND x', access).categories).toEqual(['other'])
  })

  it('ignores comments and blank lines', () => {
    expect(classifyRedis('# comment\n\nGET a', access).kind).toBe('read')
  })

  it('fails closed without a checker', () => {
    expect(classifyRedis('GET a').categories).toEqual(['other'])
  })

  it('routes redis connections to the redis classifier', () => {
    expect(classifyQuery('GET a', 'redis', { redisCommandAccess: access }).kind).toBe('read')
  })
})

describe('identifierDialectFor', () => {
  it.each([
    ['postgresql', 'psql'],
    ['cockroachdb', 'psql'],
    ['redshift', 'psql'],
    ['mariadb', 'mysql'],
    ['tidb', 'mysql'],
    ['sqlite', 'sqlite'],
    ['sqlserver', 'mssql'],
    ['bigquery', 'bigquery'],
  ] as const)('maps %s to %s', (type, dialect) => {
    expect(identifierDialectFor(type)).toBe(dialect)
  })
})

describe('literal bypasses', () => {
  it.each([
    ["with i as (insert into a values (1) returning 1), j as (select '\\'), d as (delete from t returning 1) select 1", 'postgresql', 'delete'],
    ['with j as (select 1 # 2), d as (delete from t returning 1) select 1', 'postgresql', 'delete'],
    ['with j as (select "a\\"), d as (delete from t returning 1) select 1', 'postgresql', 'delete'],
    ['with j as (select a$$b), d as (delete from t returning 1) select 1', 'postgresql', 'other'],
    ["with j as (select e'\\''), d as (update t set x = 1 returning 1) select 1", 'postgresql', 'other'],
    ['select 1; /* /* */ delete from t', 'mysql', 'delete'],
    ['select 1; /*! delete from t */', 'mysql', 'other'],
    ['select 1 /*M! , (delete) */', 'mariadb', 'other'],
    ["select 'unterminated", 'postgresql', 'other'],
    ["select set_config('default_transaction_read_only', 'off', false)", 'postgresql', 'other'],
    ["SELECT pg_catalog.SET_CONFIG('default_transaction_read_only', 'off', false)", 'postgresql', 'other'],
    ["select \"set_config\"('default_transaction_read_only', 'off', false)", 'postgresql', 'other'],
    ["select * from (select set_config('x.y', '1', true)) s", 'postgresql', 'other'],
  ] as const)('classifies %s as a write', (sql, type, category) => {
    const result = classifyQuery(sql, type)
    expect(result.kind).toBe('write')
    expect(result.categories).toContain(category)
  })

  it.each([
    ["select 'it\\'s' from t", 'mysql'],
    ["select e'it\\'s delete' from t", 'postgresql'],
    ['select $tag$ delete $tag$', 'postgresql'],
    ["select 1 -- delete\n", 'mysql'],
    ['select 1 # delete', 'mysql'],
    ['select `delete` from t', 'mysql'],
    ['select 1 /* /* delete */ */', 'postgresql'],
  ] as const)('keeps %s a read', (sql, type) => {
    expect(classifyQuery(sql, type).kind).toBe('read')
  })
})

describe('stripSqlLiterals', () => {
  it('removes strings, comments and dollar-quoted bodies', () => {
    const stripped = stripSqlLiterals("select 'delete' /* drop */ , $$ update $$ -- insert\n from t", 'psql')
    expect(stripped).not.toMatch(/delete|drop|update|insert/)
    expect(stripped).toMatch(/select/)
    expect(stripped).toMatch(/from t/)
  })
})
