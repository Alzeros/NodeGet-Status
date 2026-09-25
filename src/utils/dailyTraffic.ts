import type { Node } from '../types'
import { displayName } from './derive'
import { shiftDayId } from './trafficCycle'

/*
 * 每日流量柱状图的数据。已结束的日子来自 worker 归档的 dailyHistory，
 * 今天用实时窗口 dailyTraffic——它被当前计数器往前推着走，柱子会动。
 * 柱子是全部机器合计；每根柱子同时留着分机器的明细，悬停时列出来。
 */

export const DAILY_CHART_DAYS = 30

/** 一台机器在某一天的用量 */
export interface DailyBarNode {
  uuid: string
  source: string
  name: string
  region: string | null
  received: number
  transmitted: number
  total: number
}

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
  /** 分机器明细，按用量降序 */
  nodes: DailyBarNode[]
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
  return { id, total: 0, received: 0, transmitted: 0, machines: 0, partial: 0, reset: 0, nodes: [], today, empty: true }
}

/** 地区代码规整成两位大写字母，无效值返回 null（与 StatsView 的 regionOf 同口径） */
function regionOf(n: Node) {
  const code = n.meta?.region?.trim().toUpperCase()
  return code && /^[A-Z]{2}$/.test(code) ? code : null
}

export function buildDailyBars(nodes: Node[], count = DAILY_CHART_DAYS): DailyChart | null {
  // 窗口 id 由主控写定，"今天"以它为准，而不是浏览器的今天
  const todayId = nodes.find(n => n.dailyTraffic)?.dailyTraffic?.cycleId ?? null
  const byId = new Map<string, DailyBar>()
  const add = (
    n: Node,
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
    b.nodes.push({
      uuid: n.uuid,
      source: n.source,
      name: displayName(n),
      region: regionOf(n),
      received,
      transmitted,
      total: received + transmitted,
    })
    byId.set(id, b)
  }
  for (const n of nodes) {
    for (const d of n.dailyHistory ?? []) {
      // 历史只收已结束的日子；今天以实时窗口为准，免得两边都算一遍
      if (todayId && d.id >= todayId) continue
      add(n, d.id, d.received, d.transmitted, d, false)
    }
    if (n.dailyTraffic) add(n, n.dailyTraffic.cycleId, n.dailyTraffic.received, n.dailyTraffic.transmitted, {}, true)
  }
  if (!byId.size) return null
  for (const b of byId.values()) b.nodes.sort((a, c) => c.total - a.total)

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

/** 悬停明细里单独列出的门槛与行数上限，其余并成"其他" */
export const BREAKDOWN_MIN_BYTES = 1024 ** 3
export const BREAKDOWN_MAX_ROWS = 10

export interface Breakdown {
  rows: DailyBarNode[]
  other: { count: number; total: number } | null
}

/**
 * 悬停明细：按用量降序单独列出，不足 1 GiB 的和超出行数上限的并成"其他"，
 * 几十台机器的一天也不会拖出一长条。nodes 需已按 total 降序。
 */
export function foldBreakdown(nodes: DailyBarNode[], min = BREAKDOWN_MIN_BYTES, max = BREAKDOWN_MAX_ROWS): Breakdown {
  const rows: DailyBarNode[] = []
  let count = 0
  let total = 0
  for (const n of nodes) {
    if (n.total >= min && rows.length < max) {
      rows.push(n)
    } else {
      count++
      total += n.total
    }
  }
  return { rows, other: count ? { count, total } : null }
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
