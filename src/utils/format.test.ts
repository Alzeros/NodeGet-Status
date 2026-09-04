import { describe, test, expect } from 'vitest'
import { bytes, bytesParts } from './format'

const GiB = 1024 ** 3
const TiB = 1024 ** 4

// 回归防线：1–10 TiB 的 4 位有效数字是为全局汇总加的，曾经因为写在共用的 bytes()
// 里，把卡片上的 "1 TiB" 全撑成了 "1.000 TiB"。这两个 describe 就是那条界线。

describe('bytes — 卡片等空间紧张处用，紧凑', () => {
  test('整数 TiB 不补多余的零', () => {
    expect(bytes(TiB)).toBe('1 TiB')
    expect(bytes(2 * TiB)).toBe('2 TiB')
    expect(bytes(9.99 * TiB)).toBe('9.99 TiB')
  })

  test('非整数按 prettyBytes 默认精度，不撑到 4 位', () => {
    expect(bytes(1.23456 * TiB)).toBe('1.23 TiB')
    expect(bytes(1.5 * TiB)).toBe('1.5 TiB')
  })

  test('TiB 区间之外走常规单位', () => {
    expect(bytes(842.31 * GiB)).toBe('842 GiB')
    expect(bytes(0.5 * TiB)).toBe('512 GiB')
    expect(bytes(10 * TiB)).toBe('10 TiB')
  })

  test('零值与空值统一显示 0 B', () => {
    expect(bytes(0)).toBe('0 B')
    expect(bytes(undefined)).toBe('0 B')
    expect(bytes(null)).toBe('0 B')
    expect(bytes(-1)).toBe('0 B')
  })
})

describe('bytesParts — 全局汇总专用，保留高精度', () => {
  test('1–10 TiB 区间保留 4 位有效数字', () => {
    expect(bytesParts(1.23456 * TiB)).toEqual({ num: '1.235', unit: 'TiB' })
  })

  test('数字与单位能拆开', () => {
    expect(bytesParts(TiB)).toEqual({ num: '1.000', unit: 'TiB' })
    expect(bytesParts(842.31 * GiB)).toEqual({ num: '842', unit: 'GiB' })
  })

  test('零值与空值也能拆开', () => {
    expect(bytesParts(0)).toEqual({ num: '0', unit: 'B' })
    expect(bytesParts(undefined)).toEqual({ num: '0', unit: 'B' })
    expect(bytesParts(null)).toEqual({ num: '0', unit: 'B' })
  })
})
