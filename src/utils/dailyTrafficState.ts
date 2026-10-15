import type { DailyTrafficDay, DynamicSummary, MonthlyTraffic } from '../types'
import { utc8DateId } from './trafficCycle'

function object(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
}

function parseObject(raw: unknown) {
  try {
    return object(typeof raw === 'string' ? JSON.parse(raw) : raw)
  } catch {
    return undefined
  }
}

function nonnegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function flags(value: Record<string, unknown>) {
  return { ...(value.partial === true && { partial: true }), ...(value.reset === true && { reset: true }) }
}

/** 不兼容旧 day：它是主控本地日，不能挪作 UTC+8 日窗口。 */
export function parseDailyWindow(raw: unknown): MonthlyTraffic | undefined {
  const value = object(parseObject(raw)?.dayUtc8)
  if (!value || typeof value.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.id)) return undefined
  const received = nonnegative(value.received)
  const transmitted = nonnegative(value.transmitted)
  const startedAt = nonnegative(value.startedAt)
  const updatedAt = nonnegative(value.updatedAt)
  if (received == null || transmitted == null || startedAt == null || updatedAt == null) return undefined
  const revision = nonnegative(value.revision)
  return {
    cycleId: value.id, received, transmitted, total: received + transmitted,
    lastReceived: nonnegative(value.lastReceived), lastTransmitted: nonnegative(value.lastTransmitted),
    startedAt, updatedAt, ...flags(value),
    ...(revision != null && Number.isSafeInteger(revision) && revision > 0 ? { revision } : {}),
  }
}

/** 只接受新 key 的固定时区历史；snapshots 是 Worker 的中间态，不参与图表。 */
export function parseDailyHistory(raw: unknown): DailyTrafficDay[] | undefined {
  const value = parseObject(raw)
  if (value?.timeZone !== 'UTC+08:00') return undefined
  const days = object(value.days)
  if (!days) return undefined
  const out: DailyTrafficDay[] = []
  for (const [id, rawDay] of Object.entries(days)) {
    const day = object(rawDay)
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(id)) continue
    const received = nonnegative(day.received)
    const transmitted = nonnegative(day.transmitted)
    // 缺失/损坏记录不能显示成可靠的零用量。
    if (received == null || transmitted == null) continue
    out.push({ id, received, transmitted, ...flags(day) })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function currentDailyTraffic(record: MonthlyTraffic | undefined, now: Date = new Date()): MonthlyTraffic | undefined {
  return record?.cycleId === utc8DateId(now) ? record : undefined
}

/** 先筛日再预览；updatedAt 是 Worker 使用的真实采样时刻，不允许落后动态行推进它。 */
export function previewDailyTraffic(record: MonthlyTraffic | undefined, row: DynamicSummary | null, now: Date = new Date()): MonthlyTraffic | undefined {
  const current = currentDailyTraffic(record, now)
  if (!current || !row || !Number.isFinite(row.timestamp) || row.timestamp <= current.updatedAt || row.timestamp > now.getTime()) return current
  if (utc8DateId(new Date(row.timestamp)) !== current.cycleId) return current
  const delta = (value: number | undefined, previous: number | undefined) => {
    const total = nonnegative(value)
    return total != null && previous != null && total >= previous ? total - previous : 0
  }
  const received = current.received + delta(row.total_received, current.lastReceived)
  const transmitted = current.transmitted + delta(row.total_transmitted, current.lastTransmitted)
  return { ...current, received, transmitted, total: received + transmitted }
}

type DailyTrafficMap = Map<string, MonthlyTraffic>

/** 同日优先使用 Worker 修订号，采样时间不必为补边界/修正标记而伪造前进。 */
function compareDailyTraffic(a: MonthlyTraffic, b: MonthlyTraffic): number {
  if (a.cycleId !== b.cycleId) return a.cycleId > b.cycleId ? 1 : -1
  if (a.revision != null || b.revision != null) {
    if (a.revision == null) return -1
    if (b.revision == null) return 1
    return a.revision - b.revision
  }
  return a.updatedAt - b.updatedAt
}

function mergeDailyTraffic(previous: DailyTrafficMap, updates: DailyTrafficMap): DailyTrafficMap {
  let next = previous
  for (const [key, value] of updates) {
    const current = previous.get(key)
    if (current && compareDailyTraffic(current, value) >= 0) continue
    if (next === previous) next = new Map(previous)
    next.set(key, value)
  }
  return next
}

/** 每个 effect 一份接收器：按日/修订号拒绝乱序，旧 Worker 才回退到采样时刻排序。 */
export function createDailyTrafficReceiver(
  commit: (update: (previous: DailyTrafficMap) => DailyTrafficMap) => void,
  observe: (key: string, id: string) => Promise<void>,
) {
  let active = true
  let latest: DailyTrafficMap = new Map()
  return {
    async accept(updates: DailyTrafficMap): Promise<void> {
      if (!active) return
      const next = mergeDailyTraffic(latest, updates)
      if (next !== latest) {
        latest = next
        // React 可能延迟执行 updater；清理后的旧 effect 连已排队的提交也必须失效。
        commit(previous => active ? mergeDailyTraffic(previous, updates) : previous)
      }
      const reads: Promise<void>[] = []
      for (const [key, value] of updates) {
        const accepted = latest.get(key)
        if (!accepted || compareDailyTraffic(accepted, value) !== 0) continue
        // 同版本不重复提交；仍让 observe 检查失败冷却，避免静止桶永远无法恢复历史。
        reads.push(observe(key, accepted.cycleId))
      }
      await Promise.all(reads)
    },
    dispose() { active = false },
  }
}

/** 全主控历史共用一次加载。只确认成功读取的 revision；在途换桶必须再读一次。 */
export function createDailyHistoryRefresh(load: () => Promise<void>): {
  observe(key: string, id: string): Promise<void>
  refresh(): Promise<void>
} {
  const observed = new Map<string, string>()
  let revision = 0
  let loadedRevision = -1
  let failedRevision = -1
  let retryDelay = 0
  let retryAt = 0
  let inflight: Promise<void> | undefined

  function refresh(): Promise<void> {
    if (!inflight) {
      inflight = (async () => {
        let loadingRevision = revision
        try {
          do {
            loadingRevision = revision
            // 延后调用也使同步抛错走同一清理路径，inflight 不会卡在 rejected Promise 上。
            await Promise.resolve().then(load)
            loadedRevision = loadingRevision
            failedRevision = -1
            retryDelay = 0
          } while (loadedRevision !== revision)
        } catch (error) {
          loadedRevision = -1
          retryDelay = failedRevision === loadingRevision ? Math.min(retryDelay * 2, 60_000) : 30_000
          failedRevision = loadingRevision
          retryAt = Date.now() + retryDelay
          throw error
        } finally {
          inflight = undefined
        }
      })()
    }
    return inflight
  }

  return {
    refresh,
    observe(key, id) {
      if (observed.get(key) !== id) {
        observed.set(key, id)
        revision++
      }
      if (inflight) return inflight
      // 2 秒动态轮询不应把失败变为全主控 history 请求风暴；新日/新节点不受旧失败冷却限制。
      if (loadedRevision === revision || (failedRevision === revision && Date.now() < retryAt)) return Promise.resolve()
      return refresh()
    },
  }
}
