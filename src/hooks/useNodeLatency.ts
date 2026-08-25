import { useEffect, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { TaskQueryResult } from '../types'

export type LatencyTimeRange = '1h' | '6h' | '24h'

const TIME_RANGES = {
  '1h': { windowMs: 60 * 60 * 1000, refreshMs: 10_000 },
  '6h': { windowMs: 6 * 60 * 60 * 1000, refreshMs: 30_000 },
  '24h': { windowMs: 24 * 60 * 60 * 1000, refreshMs: 60_000 },
}

const QUERY_TIMEOUT_MS = 20_000
// 单次查询后端返回上限（实测打满 1000 即被截断）
const PAGE_MAX_ROWS = 1000
// 一轮查询最多翻多少页，防止后端口异常时烧资源
const MAX_PAGES = 20

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter(r => r.cron_source && r.cron_source !== '未知')
    .sort((a, b) => a.timestamp - b.timestamp)
}

// 按窗口 [from, to] 拉数据；如果某次返回打满 PAGE_MAX_ROWS，
// 说明被后端上限截断，翻页继续直到窗口覆盖完整或翻页上限
async function queryFull(
  entry: any,
  uuid: string,
  window: [number, number],
  type: 'ping' | 'tcp_ping',
  isCancelled: () => boolean,
): Promise<TaskQueryResult[]> {
  const all: TaskQueryResult[] = []
  let cursorFrom = window[0]
  for (let page = 0; page < MAX_PAGES; page++) {
    if (isCancelled()) break
    const rows = await taskQuery(
      entry.client,
      [{ uuid }, { timestamp_from_to: [cursorFrom, window[1]] }, { type }],
      QUERY_TIMEOUT_MS,
    ).catch(() => [] as TaskQueryResult[])
    if (isCancelled()) break
    if (rows.length === 0) break
    all.push(...rows)
    if (rows.length < PAGE_MAX_ROWS) break // 没打满 = 拿完了
    const maxTs = Math.max(...rows.map(r => r.timestamp))
    if (maxTs <= cursorFrom) break // 没推进 = 防止死循环
    cursorFrom = maxTs + 1 // 下一次从这个 timestamp 之后开始
  }
  return all
}

export function useNodeLatency(
  pool: BackendPool | null,
  source: string | null,
  uuid: string | null,
  timeRange: LatencyTimeRange = '1h',
) {
  const [pingData, setPingData] = useState<TaskQueryResult[]>([])
  const [tcpData, setTcpData] = useState<TaskQueryResult[]>([])
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    setPingData([])
    setTcpData([])

    if (!pool || !source || !uuid) return
    const entry = pool.entries.find(e => e.name === source)
    if (!entry) return

    let cancelled = false
    const isCancelled = () => cancelled

    const { windowMs, refreshMs } = TIME_RANGES[timeRange]

    const fetchOnce = async () => {
      const now = Date.now()
      const window: [number, number] = [now - windowMs, now]
      setLoading(true)

      const [pingResult, tcpResult] = await Promise.allSettled([
        queryFull(entry, uuid, window, 'ping', isCancelled),
        queryFull(entry, uuid, window, 'tcp_ping', isCancelled),
      ])

      if (cancelled) return
      if (pingResult.status === 'fulfilled') {
        setPingData(clean(pingResult.value))
      }
      if (tcpResult.status === 'fulfilled') setTcpData(clean(tcpResult.value))
      setLoading(false)
      setInitialized(true)
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pool, source, uuid, timeRange])

  return { pingData, tcpData, loading, initialized }
}
