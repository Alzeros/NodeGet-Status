import { describe, test, expect } from 'vitest'
import {
  clampResetDay,
  currentCycleId,
  daysUntilNextReset,
  nextCycleStartId,
  nextResetTime,
} from './trafficCycle'

// 全部用 new Date(y, m, d, h) 构造本地时间——重置时刻的语义就是"本地零点"。
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0)

describe('clampResetDay', () => {
  test('非法值一律回落到 1 号', () => {
    expect(clampResetDay(undefined)).toBe(1)
    expect(clampResetDay(null)).toBe(1)
    expect(clampResetDay(0)).toBe(1)
    expect(clampResetDay(32)).toBe(1)
    expect(clampResetDay(Number.NaN)).toBe(1)
  })

  test('合法值取整保留', () => {
    expect(clampResetDay(15)).toBe(15)
    expect(clampResetDay(31)).toBe(31)
    expect(clampResetDay(15.9)).toBe(15)
  })
})

describe('流量周期切片', () => {
  test('重置日在今天之前：本周期从上个月的重置日算起', () => {
    const now = at(2026, 9, 4) // 9 月 4 日，重置日 1 号已过
    expect(currentCycleId(1, now)).toBe('2026-09-01')
    expect(nextCycleStartId(1, now)).toBe('2026-10-01')
  })

  test('重置日还没到：本周期仍是上个月那一段', () => {
    const now = at(2026, 9, 4) // 重置日 5 号未到
    expect(currentCycleId(5, now)).toBe('2026-08-05')
    expect(nextCycleStartId(5, now)).toBe('2026-09-05')
  })

  test('当天正好是重置日：周期从今天开始', () => {
    const now = at(2026, 9, 15)
    expect(currentCycleId(15, now)).toBe('2026-09-15')
    expect(nextCycleStartId(15, now)).toBe('2026-10-15')
  })

  test('重置日 31 号遇到小月：按该月天数钳制', () => {
    // 2 月只有 28 天，1 月 31 号起始的周期应在 2 月 28 号重置
    expect(nextCycleStartId(31, at(2026, 2, 10))).toBe('2026-02-28')
    // 4 月只有 30 天
    expect(nextCycleStartId(31, at(2026, 4, 10))).toBe('2026-04-30')
    // 闰年 2 月有 29 天
    expect(nextCycleStartId(31, at(2028, 2, 10))).toBe('2028-02-29')
  })

  test('跨年：12 月的周期重置到下一年 1 月', () => {
    const now = at(2026, 12, 20)
    expect(currentCycleId(15, now)).toBe('2026-12-15')
    expect(nextCycleStartId(15, now)).toBe('2027-01-15')
  })

  test('1 月的周期起始要回溯到上一年 12 月', () => {
    expect(currentCycleId(5, at(2026, 1, 3))).toBe('2025-12-05')
  })
})

describe('nextResetTime', () => {
  test('返回重置日当天的本地零点，而不是 UTC 零点', () => {
    const next = nextResetTime(1, at(2026, 9, 4, 18))
    expect(next.getFullYear()).toBe(2026)
    expect(next.getMonth()).toBe(9) // 10 月
    expect(next.getDate()).toBe(1)
    expect(next.getHours()).toBe(0)
    expect(next.getMinutes()).toBe(0)
    expect(next.getSeconds()).toBe(0)
  })

  test('与 nextCycleStartId 始终一致', () => {
    const now = at(2026, 9, 4, 18)
    const d = nextResetTime(5, now)
    expect(nextCycleStartId(5, now)).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  })
})

describe('daysUntilNextReset', () => {
  test('按整天向下取整，不四舍五入', () => {
    // 距 10-01 00:00 还有 26 天 12 小时 → 算 26 天
    expect(daysUntilNextReset(1, at(2026, 9, 4, 12))).toBe('26天')
    // 刚好整 24 小时 → 算 1 天
    expect(daysUntilNextReset(5, at(2026, 9, 4, 0))).toBe('1天')
    // 差 1 分钟到零点 → 不足一天
    expect(daysUntilNextReset(1, at(2026, 9, 30, 23))).toBe('不足1天')
  })

  test('剩余不足 24 小时一律算不足一天', () => {
    expect(daysUntilNextReset(5, at(2026, 9, 4, 12))).toBe('不足1天')
    expect(daysUntilNextReset(5, at(2026, 9, 4, 23))).toBe('不足1天')
  })

  test('跨月与月末钳制同样生效', () => {
    // 1 月 31 号起始的周期在 2 月 28 号重置
    expect(daysUntilNextReset(31, at(2026, 2, 1, 0))).toBe('27天')
  })
})
