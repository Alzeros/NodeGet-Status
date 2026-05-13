import type { LatencyType, TaskQueryResult } from '../types'

const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
]

export function latencyColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function pickValue(row: TaskQueryResult, type: LatencyType): number | null {
  const v = row.task_event_result?.[type]
  return row.success && typeof v === 'number' ? v : null
}

function seriesNames(rows: TaskQueryResult[]) {
  const set = new Set<string>()
  for (const r of rows) set.add(r.cron_source || '未知')
  return [...set].sort((a, b) => a.localeCompare(b))
}

export interface ChartPoint {
  t: number
  [series: string]: number | null
}

export interface ChartSeries {
  name: string
  color: string
}

// 计算数组的 p 分位数（0-1）
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))
  return sorted[idx]
}

// 中值滤波：窗口大小为3，消除瞬时尖刺
function medianFilter(data: ChartPoint[], seriesNames: string[]): ChartPoint[] {
  if (data.length < 3) return data
  const result: ChartPoint[] = []

  for (let i = 0; i < data.length; i++) {
    const next: ChartPoint = { t: data[i].t }
    for (const name of seriesNames) {
      if (i === 0 || i === data.length - 1) {
        next[name] = data[i][name]
        continue
      }
      const window = [data[i - 1][name], data[i][name], data[i + 1][name]].filter(
        (v): v is number => v != null,
      )
      if (window.length < 3) {
        next[name] = data[i][name]
      } else {
        window.sort((a, b) => a - b)
        next[name] = window[1] // 中值
      }
    }
    result.push(next)
  }

  return result
}

// 均值平滑：每 windowSize 个点取均值，过滤微小跳变
function meanSmooth(
  data: ChartPoint[],
  seriesNames: string[],
  windowSize: number,
): ChartPoint[] {
  if (data.length < windowSize) return data
  const result: ChartPoint[] = []

  for (let i = 0; i < data.length; i += windowSize) {
    const window = data.slice(i, i + windowSize)
    const midIdx = Math.floor(window.length / 2)
    const next: ChartPoint = { t: window[midIdx].t }

    for (const name of seriesNames) {
      const vals = window
        .map(p => p[name])
        .filter((v): v is number => v != null)
      if (vals.length) {
        next[name] = vals.reduce((s, v) => s + v, 0) / vals.length
      } else {
        next[name] = null
      }
    }
    result.push(next)
  }

  return result
}

// 降采样：按时间窗口聚合，减少渲染点数量
function downsample(
  data: ChartPoint[],
  seriesNames: string[],
  targetPoints: number,
): ChartPoint[] {
  if (data.length <= targetPoints) return data

  const bucketSize = Math.ceil(data.length / targetPoints)
  const result: ChartPoint[] = []

  for (let i = 0; i < data.length; i += bucketSize) {
    const bucket = data.slice(i, i + bucketSize)
    const t = bucket[Math.floor(bucket.length / 2)].t
    const pt: ChartPoint = { t }

    for (const name of seriesNames) {
      const vals = bucket
        .map(p => p[name])
        .filter((v): v is number => v != null)
      if (vals.length) {
        vals.sort((a, b) => a - b)
        pt[name] = percentile(vals, 0.95) // 用 P95 作为聚合值，保留峰值特征但减少噪声
      } else {
        pt[name] = null
      }
    }
    result.push(pt)
  }

  return result
}

// 数据预处理管道：中值滤波 → 均值平滑 → 降采样
export function preprocessLatencyData(
  data: ChartPoint[],
  seriesNames: string[],
  timeRange: '1h' | '6h' | '24h' | '7d',
): ChartPoint[] {
  // 1. 中值滤波消除瞬时尖刺
  let result = medianFilter(data, seriesNames)

  // 2. 1小时视图额外进行均值平滑（每3个点取均值），过滤微小跳变
  if (timeRange === '1h') {
    result = meanSmooth(result, seriesNames, 3)
  }

  // 3. 根据时间范围降采样（大幅减少1小时视图的渲染点数）
  const targetPoints =
    timeRange === '1h' ? 60 : timeRange === '6h' ? 150 : timeRange === '24h' ? 300 : 400
  result = downsample(result, seriesNames, targetPoints)

  return result
}

function forwardFill(data: ChartPoint[], names: string[]) {
  const last: Record<string, number | null> = {}
  for (const n of names) last[n] = null
  for (const pt of data) {
    for (const n of names) {
      const v = pt[n]
      if (v == null) pt[n] = last[n]
      else last[n] = v
    }
  }
}

export function buildLatencyChart(rows: TaskQueryResult[], type: LatencyType) {
  const names = seriesNames(rows)
  const series: ChartSeries[] = names.map(name => ({ name, color: latencyColor(name) }))
  const byTs = new Map<number, ChartPoint>()

  for (const r of rows) {
    const t = normalizeTs(r.timestamp)
    let pt = byTs.get(t)
    if (!pt) {
      pt = { t }
      for (const n of names) pt[n] = null
      byTs.set(t, pt)
    }
    pt[r.cron_source || '未知'] = pickValue(r, type)
  }

  const data = [...byTs.values()].sort((a, b) => a.t - b.t)
  forwardFill(data, names)
  return { data, series }
}

export interface LatencyStats {
  name: string
  color: string
  avg: number | null
  jitter: number | null
  lossRate: number
}

export function computeLatencyStats(rows: TaskQueryResult[], type: LatencyType): LatencyStats[] {
  const stats = seriesNames(rows).map<LatencyStats>(name => {
    const list = rows.filter(r => (r.cron_source || '未知') === name)
    const vals: number[] = []
    for (const r of list) {
      const v = pickValue(r, type)
      if (v != null) vals.push(v)
    }

    const color = latencyColor(name)
    const lossRate = list.length ? ((list.length - vals.length) / list.length) * 100 : 0
    if (!vals.length) return { name, color, avg: null, jitter: null, lossRate }

    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    const jitter =
      vals.length >= 2
        ? vals.slice(1).reduce((s, v, i) => s + Math.abs(v - vals[i]), 0) / (vals.length - 1)
        : null

    return { name, color, avg, jitter, lossRate }
  })

  return stats.sort((a, b) => {
    const av = a.avg ?? Infinity
    const bv = b.avg ?? Infinity
    if (av !== bv) return av - bv
    const aj = a.jitter ?? Infinity
    const bj = b.jitter ?? Infinity
    if (aj !== bj) return aj - bj
    return a.lossRate - b.lossRate
  })
}
