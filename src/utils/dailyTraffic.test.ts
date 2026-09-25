import { describe, test, expect } from 'vitest'
import { buildDailyBars, niceBytes } from './dailyTraffic'
import { shiftDayId } from './trafficCycle'
import type { DailyTrafficDay, MonthlyTraffic, Node } from '../types'

const G = 1024 ** 3

function window(cycleId: string, received: number, transmitted: number): MonthlyTraffic {
  return { cycleId, received, transmitted, total: received + transmitted, startedAt: 0, updatedAt: 0 }
}

function node(uuid: string, dailyHistory?: DailyTrafficDay[], dailyTraffic?: MonthlyTraffic): Node {
  return { uuid, dailyHistory, dailyTraffic } as unknown as Node
}

describe('shiftDayId', () => {
  test('跨月、跨年、往前往后都按日历走', () => {
    expect(shiftDayId('2026-09-26', -1)).toBe('2026-09-25')
    expect(shiftDayId('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDayId('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDayId('2026-02-28', 1)).toBe('2026-03-01')
    expect(shiftDayId('2026-09-26', -29)).toBe('2026-08-28')
  })
})

describe('buildDailyBars', () => {
  test('没有任何数据返回 null', () => {
    expect(buildDailyBars([node('a')])).toBeNull()
  })

  test('跨机器按日期合计，今天来自实时窗口，空缺的日子占位', () => {
    const a = node('a', [{ id: '2026-09-24', received: 1 * G, transmitted: 2 * G }, { id: '2026-09-25', received: 1 * G, transmitted: 1 * G }], window('2026-09-26', 0.5 * G, 0.5 * G))
    const b = node('b', [{ id: '2026-09-25', received: 3 * G, transmitted: 3 * G, reset: true }], window('2026-09-26', 1 * G, 0))
    const chart = buildDailyBars([a, b], 5)!
    expect(chart.bars.map(x => x.id)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
    expect(chart.bars.map(x => x.total / G)).toEqual([0, 0, 3, 8, 2])
    expect(chart.bars[0].empty).toBe(true)
    expect(chart.bars[3]).toMatchObject({ machines: 2, reset: 1, partial: 0, today: false })
    expect(chart.bars[4]).toMatchObject({ machines: 2, today: true, received: 1.5 * G, transmitted: 0.5 * G })
    // 汇总只看已结束的日子：今天还在涨，不能拉低日均
    expect(chart.days).toBe(2)
    expect(chart.sum / G).toBe(11)
    expect(chart.avg / G).toBe(5.5)
    expect(chart.peak?.id).toBe('2026-09-25')
    expect(chart.today?.id).toBe('2026-09-26')
    expect(chart.flagged).toBe(1)
  })

  test('历史里混进今天或未来的日子时以实时窗口为准，不重复计', () => {
    const a = node('a', [{ id: '2026-09-26', received: 9 * G, transmitted: 9 * G }], window('2026-09-26', 1 * G, 1 * G))
    const chart = buildDailyBars([a], 3)!
    expect(chart.today?.total).toBe(2 * G)
    expect(chart.today?.machines).toBe(1)
  })

  test('没有实时窗口时，以最近有记录的一天收尾', () => {
    const a = node('a', [{ id: '2026-09-20', received: 1, transmitted: 1 }])
    const chart = buildDailyBars([a], 3)!
    expect(chart.todayId).toBeNull()
    expect(chart.today).toBeNull()
    expect(chart.bars.map(x => x.id)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20'])
  })
})

describe('niceBytes', () => {
  test('向上取到当前单位下的整数刻度', () => {
    expect(niceBytes(41.2 * G)).toBe(50 * G)
    expect(niceBytes(1.2 * G)).toBe(1.5 * G)
    expect(niceBytes(1000 * G)).toBe(1024 * G)
    expect(niceBytes(1024 * G)).toBe(1024 ** 4)
    expect(niceBytes(0)).toBe(1)
  })
})
