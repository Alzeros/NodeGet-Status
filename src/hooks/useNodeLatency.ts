import { useEffect, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { TaskQueryResult } from '../types'

export type LatencyTimeRange = '1h' | '6h' | '24h' | '7d'

const TIME_RANGES = {
  '1h': { windowMs: 60 * 60 * 1000, refreshMs: 10_000 },
  '6h': { windowMs: 6 * 60 * 60 * 1000, refreshMs: 30_000 },
  '24h': { windowMs: 24 * 60 * 60 * 1000, refreshMs: 60_000 },
  '7d': { windowMs: 7 * 24 * 60 * 60 * 1000, refreshMs: 60_000 },
}

const QUERY_TIMEOUT_MS = 20_000

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter(r => r.cron_source && r.cron_source !== '未知')
    .sort((a, b) => a.timestamp - b.timestamp)
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

    const { windowMs, refreshMs } = TIME_RANGES[timeRange]

    const fetchOnce = async () => {
      const now = Date.now()
      const window: [number, number] = [now - windowMs, now]
      setLoading(true)

      const [ping, tcp] = await Promise.allSettled([
        taskQuery(
          entry.client,
          [{ uuid }, { timestamp_from_to: window }, { type: 'ping' }],
          QUERY_TIMEOUT_MS,
        ),
        taskQuery(
          entry.client,
          [{ uuid }, { timestamp_from_to: window }, { type: 'tcp_ping' }],
          QUERY_TIMEOUT_MS,
        ),
      ])

      if (cancelled) return
      if (ping.status === 'fulfilled') setPingData(clean(ping.value))
      if (tcp.status === 'fulfilled') setTcpData(clean(tcp.value))
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
