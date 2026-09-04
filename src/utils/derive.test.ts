import { describe, test, expect } from 'vitest'
import { billedTraffic } from './derive'

// 单向计费（mode='max'）解决的是「剩余额度失真」：
// 商家给的 limit 是单向额度，双向合计去对比会把用量撑到接近两倍。
// 显示层的总流量（双向累计）不受此函数影响，只在 percent 和 X/limit 对比处使用。

describe('billedTraffic — 计费口径折算', () => {
  test('dual：双向合计（默认口径，行为不变）', () => {
    expect(billedTraffic(100, 200, 'dual')).toBe(300)
    expect(billedTraffic(0, 0, 'dual')).toBe(0)
  })

  test('max：取上/下行较大者', () => {
    // 常见场景：上行远大于下行
    expect(billedTraffic(500, 200, 'max')).toBe(500)
    // 下行更大的机器（如下载型 VPS）同样取大者
    expect(billedTraffic(100, 800, 'max')).toBe(800)
  })

  test('上下行相等时取其一', () => {
    expect(billedTraffic(150, 150, 'max')).toBe(150)
  })

  test('max 模式下单向结果不会大于双向合计', () => {
    // 口径不变式：max(a,b) <= a+b，保证单向计费不会比双向更"贵"
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 2],
      [999, 1],
      [7 * 1024 ** 3, 3 * 1024 ** 3],
    ]
    for (const [a, b] of cases) {
      expect(billedTraffic(a, b, 'max')).toBeLessThanOrEqual(billedTraffic(a, b, 'dual'))
    }
  })
})
