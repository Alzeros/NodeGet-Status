import { describe, test, expect } from 'vitest'
import { SORT_NATURAL_DIR, nextSort, pinAbnormal } from './tableSort'
import type { NodeStatusCategory } from './stableStatus'

describe('nextSort', () => {
  test('点新列回到该列的自然方向', () => {
    expect(nextSort('default', 'asc', 'cpu')).toEqual(['cpu', 'desc'])
    expect(nextSort('cpu', 'desc', 'expire')).toEqual(['expire', 'asc'])
  })

  test('点当前列只翻转方向', () => {
    expect(nextSort('cpu', 'desc', 'cpu')).toEqual(['cpu', 'asc'])
    expect(nextSort('cpu', 'asc', 'cpu')).toEqual(['cpu', 'desc'])
  })

  test('每个排序项都有自然方向', () => {
    for (const dir of Object.values(SORT_NATURAL_DIR)) expect(['asc', 'desc']).toContain(dir)
  })
})

describe('pinAbnormal', () => {
  test('注意/风险行提到最前，两段各自保持原顺序，离线不算异常', () => {
    const st: Record<string, NodeStatusCategory> = { b: 'warning', d: 'risk', e: 'offline' }
    expect(pinAbnormal(['a', 'b', 'c', 'd', 'e'], r => st[r])).toEqual({ pinned: ['b', 'd'], rest: ['a', 'c', 'e'] })
  })

  test('没有异常时全部在 rest', () => {
    expect(pinAbnormal(['a', 'b'], () => 'normal')).toEqual({ pinned: [], rest: ['a', 'b'] })
  })
})
