import type { NgQueryResult } from '@/lib/db/models'

export const MAX_CELL_LENGTH = 4000

export function toJsonSafe(value: any, depth = 0): any {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString()
  }
  if (typeof value === 'string') {
    return value.length > MAX_CELL_LENGTH ? `${value.slice(0, MAX_CELL_LENGTH)}… (${value.length} chars)` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.from(value as Uint8Array)
    return buf.length > 64 ? `<binary ${buf.length} bytes>` : `0x${buf.toString('hex')}`
  }
  if (depth > 5) return String(value)
  if (Array.isArray(value)) return value.map((v) => toJsonSafe(v, depth + 1))
  if (typeof value === 'object') {
    if (typeof value.toJSON === 'function') {
      try {
        return toJsonSafe(value.toJSON(), depth + 1)
      } catch {
        return String(value)
      }
    }
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = toJsonSafe(v, depth + 1)
    return out
  }
  return String(value)
}

export interface FormattedResult {
  command: string | null
  fields: string[]
  rows: any[]
  rowCount: number
  affectedRows: number | null
  truncated: boolean
}

export function formatResults(results: NgQueryResult[]): { results: FormattedResult[], totalRows: number } {
  let totalRows = 0
  const formatted = (results ?? []).map((r) => {
    const rows = Array.isArray(r.rows) ? r.rows : []
    totalRows += rows.length
    const fields = uniqueNames((r.fields ?? []).map((f: any) => f?.name ?? f?.id ?? String(f)))
    const kept = rows.map((row) => {
      if (Array.isArray(row)) {
        const obj: Record<string, any> = {}
        row.forEach((v, i) => { obj[fields[i] ?? `c${i}`] = toJsonSafe(v) })
        return obj
      }
      if (row && typeof row === 'object' && fields.length && (r.fields?.[0] as any)?.id) {
        const obj: Record<string, any> = {}
        ;(r.fields as any[]).forEach((f, i) => { obj[fields[i]] = toJsonSafe(row[f.id]) })
        return obj
      }
      return toJsonSafe(row)
    })
    return {
      command: r.command ? String(r.command) : null,
      fields,
      rows: kept,
      rowCount: rows.length,
      affectedRows: typeof r.affectedRows === 'number' ? r.affectedRows : null,
      truncated: !!r.truncated,
    }
  })
  return { results: formatted, totalRows }
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return count === 1 ? name : `${name}_${count}`
  })
}

export function jsonText(value: unknown): string {
  return JSON.stringify(toJsonSafe(value), null, 2)
}
