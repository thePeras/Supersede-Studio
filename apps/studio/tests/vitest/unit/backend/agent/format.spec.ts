import { describe, it, expect } from 'vitest'
import { formatResults, MAX_CELL_LENGTH, toJsonSafe } from '@/backend/agent/format'

describe('toJsonSafe', () => {
  it('converts values that JSON cannot represent', () => {
    expect(toJsonSafe(BigInt(10))).toBe(10)
    expect(toJsonSafe(BigInt('900719925474099300'))).toBe('900719925474099300')
    expect(toJsonSafe(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z')
    expect(toJsonSafe(Buffer.from([1, 2]))).toBe('0x0102')
    expect(toJsonSafe(Buffer.alloc(100))).toBe('<binary 100 bytes>')
    expect(toJsonSafe(undefined)).toBeNull()
  })

  it('truncates long strings', () => {
    const value = toJsonSafe('x'.repeat(MAX_CELL_LENGTH + 10))
    expect(value.startsWith('x'.repeat(MAX_CELL_LENGTH))).toBe(true)
    expect(value).toContain(`${MAX_CELL_LENGTH + 10} chars`)
  })
})

describe('formatResults', () => {
  it('maps rows keyed by field id to field names', () => {
    const { results, totalRows } = formatResults([
      {
        command: 'SELECT',
        fields: [{ id: 'c0', name: 'id' }, { id: 'c1', name: 'id' }],
        rows: [{ c0: 1, c1: 2 }, { c0: 3, c1: 4 }, { c0: 5, c1: 6 }],
      },
    ])
    expect(totalRows).toBe(3)
    expect(results[0].fields).toEqual(['id', 'id_2'])
    expect(results[0].rows).toEqual([{ id: 1, id_2: 2 }, { id: 3, id_2: 4 }, { id: 5, id_2: 6 }])
    expect(results[0].truncated).toBe(false)
    expect(results[0].rowCount).toBe(3)
  })

  it('handles array rows and write results', () => {
    const { results } = formatResults([
      { fields: [{ id: 'a', name: 'a' }], rows: [[1]] },
      { command: 'DELETE', rows: [], affectedRows: 4 },
    ])
    expect(results[0].rows).toEqual([{ a: 1 }])
    expect(results[1]).toMatchObject({ command: 'DELETE', affectedRows: 4, truncated: false })
  })
})
