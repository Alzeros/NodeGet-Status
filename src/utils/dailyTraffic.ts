import type { Node } from '../types'
import { shiftDayId } from './trafficCycle'

/*
 * 每日流量柱状图的数据。已结束的日子来自 worker 归档的 dailyHistory，
 * 今天用实时窗口 dailyTraffic——它被当前计数器往前推着走，柱子会动。
 * 全部机器合计；分机器的明细留给流量排行。
 */

export const DAILY_CHART_DAYS = 30

export interface DailyBar {
  id: string
  total: number
  received: number
  transmitted: number
  /** 当天有记录的机器数 */
  machines: number
  /** 当天统计不完整的机器数（worker 当天中途才开始统计） */
  partial: number
  /** 当天计数器归零过的机器数（重启），数字偏小 */
  reset: number
  today: boolean
  /** 这一天没有任何机器有记录 */
  empty: boolean
}

export interface DailyChart {
  /** 固定 DAILY_CHART_DAYS 根，按日期升序，最右是今天（或最近有记录的一天） */
  bars: DailyBar[]
  todayId: string | null
  /** 已结束且有记录的天数 */
  days: number
  sum: number
  avg: number
  peak: DailyBar | null
  today: DailyBar | null
  max: number
  /** 有多少天带 partial / reset 标记，用于决定要不要提示 */
  flagged: number
}

function blank(id: string, today: boolean): DailyBar {
  return { id, total: 0, received: 0, transmitted: 0, machines: 0, partial: 0, reset: 0, today, empty: true }
}

export function buildDailyBars(nodes: Node[], count = DAILY_CHART_DAYS): DailyChart | null {
  // 窗口 id 由主控写定，"今天"以它为准，而不是浏览器的今天
  const todayId = nodes.find(n => n.dailyTraffic)?.dailyTraffic?.cycleId ?? null
  const byId = new Map<string, DailyBar>()
  const add = (
    id: string,
    received: number,
    transmitted: number,
    flags: { partial?: boolean; reset?: boolean },
    today: boolean,
  ) => {
    const b = byId.get(id) ?? blank(id, today)
    b.empty = false
    b.received += received
    b.transmitted += transmitted
    b.total = b.received + b.transmitted
    b.machines++
    if (flags.partial) b.partial++
    if (flags.reset) b.reset++
    byId.set(id, b)
  }
  for (const n of nodes) {
    for (const d of n.dailyHistory ?? []) {
      // 历史只收已结束的日子；今天以实时窗口为准，免得两边都算一遍
      if (todayId && d.id >= todayId) continue
      add(d.id, d.received, d.transmitted, d, false)
    }
    if (n.dailyTraffic) add(n.dailyTraffic.cycleId, n.dailyTraffic.received, n.dailyTraffic.transmitted, {}, true)
  }
  if (!byId.size) return null

  const end = todayId ?? [...byId.keys()].sort().pop()!
  const bars: DailyBar[] = []
  for (let i = count - 1; i >= 0; i--) {
    const id = shiftDayId(end, -i)
    bars.push(byId.get(id) ?? blank(id, id === todayId))
  }
  const done = bars.filter(b => !b.empty && !b.today)
  const sum = done.reduce((s, b) => s + b.total, 0)
  const peak = done.reduce<DailyBar | null>((p, b) => (!p || b.total > p.total ? b : p), null)
  return {
    bars,
    todayId,
    days: done.length,
    sum,
    avg: done.length ? sum / done.length : 0,
    peak,
    today: bars.find(b => b.today) ?? null,
    max: Math.max(...bars.map(b => b.total), 1),
    flagged: bars.filter(b => b.partial || b.reset).length,
  }
}

/**
 * 坐标轴上限：把最大值向上取到当前单位下的整数刻度（1、1.5、2、3、4、5、6、8、10、15…），
 * 这样上限和一半两条网格线才标得出干净的数，而不是 41.2 GiB / 20.6 GiB
 */
export function niceBytes(max: number) {
  if (!(max > 0)) return 1
  let unit = 1
  while (max / unit >= 1024 && unit < 1024 ** 5) unit *= 1024
  const v = max / unit
  const steps = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1024]
  return (steps.find(s => s >= v) ?? 1024) * unit
}
