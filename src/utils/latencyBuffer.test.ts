import { afterEach, describe, test, expect, vi } from 'vitest'
import { buildLatencyTracks } from './latency'
import { LATENCY_OVERLAP_MS, mergeLatencyRows, nextFetchWindow } from './latencyBuffer'
import type { LatencyBuffer } from './latencyBuffer'
import type { TaskQueryResult } from '../types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const T0 = Date.UTC(2026, 8, 25, 12, 0, 0)
const SOURCES = ['ping-重庆移动', 'ping-重庆联通', 'ping-重庆电信']

function row(task_id: number, timestamp: number, over: Partial<TaskQueryResult> = {}): TaskQueryResult {
  return {
    task_id,
    timestamp,
    uuid: 'node-1',
    success: true,
    error_message: null,
    cron_source: SOURCES[0],
    task_event_type: { ping: 'cq-cm.example' },
    task_event_result: { ping: 100 },
    ...over,
  }
}

const byTime = (a: TaskQueryResult, b: TaskQueryResult) => a.timestamp - b.timestamp
const ids = (rows: TaskQueryResult[]) => rows.map(r => r.task_id).sort((a, b) => a - b)

// 模拟后端：三网各每分钟一条，带上报延迟（到达时刻 = 时间戳 + 最多 60s）和少量丢包；
// 查询只看得到查询时刻已到达的行，按时间倒序返回（与真实后端一致）
function makeBackend(start: number, end: number) {
  let seed = 42
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const all: { row: TaskQueryResult; arrivedAt: number }[] = []
  let id = 1
  for (let t = start; t <= end; t += MIN) {
    SOURCES.forEach((source, i) => {
      // 各网错开到不同秒段，时间戳互不相同，排序结果唯一
      const ts = t + i * 1000 + Math.floor(rand() * 900)
      const ok = rand() > 0.03
      all.push({
        row: row(id++, ts, { cron_source: source, success: ok, task_event_result: ok ? { ping: 60 + rand() * 300 } : null }),
        arrivedAt: ts + Math.floor(rand() * MIN),
      })
    })
  }
  return (from: number, to: number, at: number) =>
    all
      .filter(r => r.arrivedAt <= at && r.row.timestamp >= from && r.row.timestamp <= to)
      .map(r => r.row)
      .sort((a, b) => b.timestamp - a.timestamp)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('nextFetchWindow', () => {
  test('首轮拉满整个窗口', () => {
    expect(nextFetchWindow(undefined, T0, DAY)).toEqual([T0 - DAY, T0])
  })

  test('之后从上次截止时间往前留一段重叠', () => {
    const buf: LatencyBuffer = { rows: [], fetchedTo: T0 - 30_000 }
    expect(nextFetchWindow(buf, T0, DAY)).toEqual([T0 - 30_000 - LATENCY_OVERLAP_MS, T0])
  })

  test('间隔超过整窗时（如电脑休眠一整天）不越过窗口起点', () => {
    const buf: LatencyBuffer = { rows: [], fetchedTo: T0 - 2 * DAY }
    expect(nextFetchWindow(buf, T0, DAY)).toEqual([T0 - DAY, T0])
  })
})

describe('mergeLatencyRows', () => {
  test('按 task_id 去重、裁掉窗口外的旧行、按时间升序', () => {
    const buf: LatencyBuffer = { rows: [row(1, T0 - DAY - 1), row(2, T0 - 2 * MIN)], fetchedTo: T0 - MIN }
    const next = mergeLatencyRows(buf, [row(3, T0), row(2, T0 - 2 * MIN)], T0, DAY)
    expect(next.rows.map(r => r.task_id)).toEqual([2, 3])
    expect(next.fetchedTo).toBe(T0)
  })

  test('只保留分桶用得到的字段', () => {
    const [r] = mergeLatencyRows(undefined, [row(1, T0)], T0, DAY).rows
    expect(r).not.toHaveProperty('task_event_type')
    expect(r).not.toHaveProperty('error_message')
    expect(r).toMatchObject({ task_id: 1, timestamp: T0, success: true, cron_source: SOURCES[0], task_event_result: { ping: 100 } })
  })

  test('秒级时间戳也按毫秒口径裁剪', () => {
    const old = row(1, Math.floor((T0 - 2 * DAY) / 1000))
    const recent = row(2, Math.floor((T0 - MIN) / 1000))
    expect(mergeLatencyRows(undefined, [old, recent], T0, DAY).rows.map(r => r.task_id)).toEqual([2])
  })
})

describe('增量刷新与整窗重拉等价', () => {
  test('30 秒一轮跑 2 小时（含上报延迟、中途连续失败 10 分钟），结果与同一时刻整窗重拉一致', () => {
    const query = makeBackend(T0 - DAY - 2 * HOUR, T0 + 3 * HOUR)
    let buf: LatencyBuffer | undefined
    const tick = (now: number) => {
      const [from, to] = nextFetchWindow(buf, now, DAY)
      buf = mergeLatencyRows(buf, query(from, to, now), now, DAY)
    }

    const end = T0 + 2 * HOUR
    for (let now = T0; now <= end; now += 30_000) {
      // 这段时间请求全部失败：缓存不动，恢复后从旧截止时间补拉
      if (now > T0 + HOUR && now < T0 + HOUR + 10 * MIN) continue
      tick(now)
    }

    const full = query(end - DAY, end, end).sort(byTime)
    expect(full.length).toBeGreaterThan(4000)
    expect(ids(buf!.rows)).toEqual(ids(full))

    vi.useFakeTimers()
    vi.setSystemTime(end)
    expect(buildLatencyTracks(buf!.rows, 'US', 24, HOUR)).toEqual(buildLatencyTracks(full, 'US', 24, HOUR))
  })
})
