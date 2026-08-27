import { useEffect, useMemo, useRef, useState } from 'react'
import { BackendPool } from '../api/pool'
import { dynamicSummaryMulti, kvGetMulti, listAgentUuids, staticDataMulti, taskQuery } from '../api/methods'
import { buildLatencyTracks } from '../utils/latency'
import type { LatencyTracks } from '../utils/latency'
import { isOnline } from '../utils/status'
import { clampResetDay, currentCycleId } from '../utils/trafficCycle'
import type { DynamicSummary, HistorySample, MonthlyTraffic, Node, NodeMeta, SiteConfig } from '../types'

type Agent = Pick<Node, 'uuid' | 'source' | 'meta' | 'static'>

interface BackendError {
  source: string
  error: unknown
}

const STATIC_FIELDS = ['cpu', 'system']
const DYNAMIC_FIELDS = [
  'cpu_usage',
  'used_memory',
  'total_memory',
  'available_memory',
  'used_swap',
  'total_swap',
  'total_space',
  'available_space',
  'read_speed',
  'write_speed',
  'receive_speed',
  'transmit_speed',
  'total_received',
  'total_transmitted',
  'load_one',
  'load_five',
  'load_fifteen',
  'uptime',
  'boot_time',
  'process_count',
  'tcp_connections',
  'udp_connections',
]
const META_KEYS = [
  'metadata_name',
  'metadata_region',
  'metadata_tags',
  'metadata_hidden',
  'metadata_virtualization',
  'metadata_latitude',
  'metadata_longitude',
  'metadata_order',
  'metadata_price',
  'metadata_price_unit',
  'metadata_price_cycle',
  'metadata_expire_time',
  'metadata_traffic_limit',
  'metadata_traffic_reset_day',
]
const DYN_INTERVAL_MS = 2000
const LATENCY_INTERVAL_MS = 30_000
const LATENCY_QUERY_TIMEOUT = 10_000
const HISTORY_LIMIT = 60
const TRAFFIC_CYCLE_KEY_PREFIX = 'metadata_traffic_cycle:'

interface MonthlyTrafficRecord {
  cycleId: string
  received: number
  transmitted: number
  lastReceived?: number
  lastTransmitted?: number
  startedAt: number
  updatedAt: number
}

function emptyMeta(): NodeMeta {
  return {
    name: '',
    region: '',
    tags: [],
    hidden: false,
    virtualization: '',
    lat: null,
    lng: null,
    order: 0,
    price: 0,
    priceUnit: '$',
    priceCycle: 30,
    expireTime: '',
    trafficResetDay: 1,
  }
}

function blankAgent(uuid: string, source: string): Agent {
  return { uuid, source, meta: emptyMeta(), static: {} }
}

function monthlyTrafficMapKey(source: string, uuid: string) {
  return `${source}:${uuid}`
}

function trafficCycleKvKey(cycleId: string) {
  return `${TRAFFIC_CYCLE_KEY_PREFIX}${cycleId}`
}

function parseMonthlyTrafficRecord(raw: unknown, cycleId: string): MonthlyTrafficRecord | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object') return null
    const record = value as Partial<MonthlyTrafficRecord>
    if (record.cycleId !== cycleId) return null
    return {
      cycleId,
      received: Number(record.received) || 0,
      transmitted: Number(record.transmitted) || 0,
      lastReceived: Number.isFinite(record.lastReceived) ? Number(record.lastReceived) : undefined,
      lastTransmitted: Number.isFinite(record.lastTransmitted) ? Number(record.lastTransmitted) : undefined,
      startedAt: Number(record.startedAt) || Date.now(),
      updatedAt: Number(record.updatedAt) || 0,
    }
  } catch {
    return null
  }
}

function validTotal(value?: number | null) {
  return Number.isFinite(value) && value! >= 0 ? value! : undefined
}

function toMonthlyTraffic(record: MonthlyTrafficRecord): MonthlyTraffic {
  const received = validTotal(record.received) ?? 0
  const transmitted = validTotal(record.transmitted) ?? 0
  return {
    cycleId: record.cycleId,
    received,
    transmitted,
    lastReceived: record.lastReceived,
    lastTransmitted: record.lastTransmitted,
    total: received + transmitted,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  }
}

function trafficDelta(current: number | undefined, previous: number | undefined) {
  if (current == null || previous == null) return 0
  // 计数器回退（重启/网卡重置）：丢弃这段间隙，避免把重启前后的用量叠加虚高。
  return current >= previous ? current - previous : 0
}

function previewMonthlyTraffic(record: MonthlyTraffic, row: DynamicSummary | null): MonthlyTraffic {
  if (!row) return record

  const currentReceived = validTotal(row.total_received)
  const currentTransmitted = validTotal(row.total_transmitted)
  const received = record.received + trafficDelta(currentReceived, record.lastReceived)
  const transmitted = record.transmitted + trafficDelta(currentTransmitted, record.lastTransmitted)

  return {
    ...record,
    received,
    transmitted,
    total: received + transmitted,
  }
}

function parseTrafficLimit(raw: unknown) {
  if (raw == null || raw === '') return undefined
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : undefined

  const value = String(raw).trim()
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([kmgtp]?i?b?|[kmgtp])?$/i)
  if (!match) return undefined

  const num = Number(match[1])
  if (!Number.isFinite(num) || num <= 0) return undefined

  const unit = (match[2] || 'b').toLowerCase()
  const powers: Record<string, number> = {
    b: 0,
    k: 1,
    kb: 1,
    kib: 1,
    m: 2,
    mb: 2,
    mib: 2,
    g: 3,
    gb: 3,
    gib: 3,
    t: 4,
    tb: 4,
    tib: 4,
    p: 5,
    pb: 5,
    pib: 5,
  }
  const power = powers[unit]
  return power == null ? undefined : num * 1024 ** power
}

function parseMeta(raw: Record<string, unknown>): NodeMeta {
  const lat = Number(raw.metadata_latitude)
  const lng = Number(raw.metadata_longitude)
  const order = Number(raw.metadata_order)
  const price = Number(raw.metadata_price)
  const cycle = Number(raw.metadata_price_cycle)
  const trafficLimit = parseTrafficLimit(raw.metadata_traffic_limit) ?? (500 * 1024 ** 3)
  return {
    name: raw.metadata_name ? String(raw.metadata_name) : '',
    region: raw.metadata_region ? String(raw.metadata_region) : '',
    tags: Array.isArray(raw.metadata_tags) ? raw.metadata_tags.filter(Boolean) : [],
    hidden: Boolean(raw.metadata_hidden),
    virtualization: raw.metadata_virtualization ? String(raw.metadata_virtualization) : '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    order: Number.isFinite(order) ? order : 0,
    price: Number.isFinite(price) ? price : 0,
    priceUnit: raw.metadata_price_unit ? String(raw.metadata_price_unit) : '$',
    priceCycle: Number.isFinite(cycle) && cycle > 0 ? cycle : 30,
    expireTime: raw.metadata_expire_time ? String(raw.metadata_expire_time) : '',
    trafficLimit,
    trafficResetDay: clampResetDay(Number(raw.metadata_traffic_reset_day)),
  }
}

function sampleFrom(row: DynamicSummary): HistorySample {
  const memTotal = row.total_memory || 0
  const diskTotal = row.total_space || 0
  return {
    t: row.timestamp,
    cpu: row.cpu_usage ?? null,
    mem: memTotal && row.used_memory != null ? (row.used_memory / memTotal) * 100 : null,
    disk:
      diskTotal && row.available_space != null
        ? ((diskTotal - row.available_space) / diskTotal) * 100
        : null,
    netIn: row.receive_speed ?? 0,
    netOut: row.transmit_speed ?? 0,
  }
}

export function useNodes(config: SiteConfig | null) {
  const [agents, setAgents] = useState<Map<string, Agent>>(new Map())
  const [live, setLive] = useState<Map<string, DynamicSummary>>(new Map())
  const [history, setHistory] = useState<Map<string, HistorySample[]>>(new Map())
  const [errors, setErrors] = useState<BackendError[]>([])
  const [loading, setLoading] = useState(true)
  // 元数据(节点名/地区/标签)是否已到齐。uuid 列表先到、元数据后到，
  // 期间 displayName() 只能显示 uuid 前 8 位；用它驱动骨架屏遮住这段闪烁。
  const [metaHydrated, setMetaHydrated] = useState(false)
  const [tick, setTick] = useState(0)
  const [pool, setPool] = useState<BackendPool | null>(null)
  const [latencyTracks, setLatencyTracks] = useState<Map<string, LatencyTracks>>(new Map())
  const [monthlyTraffic, setMonthlyTraffic] = useState<Map<string, MonthlyTraffic>>(new Map())

  const agentsRef = useRef(agents)
  useEffect(() => { agentsRef.current = agents }, [agents])

  useEffect(() => {
    setErrors([])
    setMetaHydrated(false)
    // config.json 还没到：保持 loading。
    // 否则这里会把 loading 置为 false 且再不置回，导致 config 到达后
    // hasNodes 仍为 false、loading 已 false —— 页面闪现一下"暂无节点"，
    // 首屏骨架屏也因此永远不显示。
    if (!config) return
    if (!config.site_tokens?.length) {
      setLoading(false)
      setMetaHydrated(true)
      return
    }
    setLoading(true)
    const pool = new BackendPool(config.site_tokens)
    setPool(pool)
    const sourceUuids = new Map<string, string[]>()
    const loadMonthlyTraffic = async (
      entry: { name: string; client: BackendPool['entries'][number]['client'] },
      rows: DynamicSummary[],
    ) => {
      const now = new Date()
      const cycleByUuid = new Map<string, string>()
      const items = rows
        .filter(row => row.uuid)
        .map(row => {
          const resetDay = agentsRef.current.get(row.uuid)?.meta?.trafficResetDay ?? 1
          const cycleId = currentCycleId(resetDay, now)
          cycleByUuid.set(row.uuid, cycleId)
          return { namespace: row.uuid, key: trafficCycleKvKey(cycleId) }
        })
      if (!items.length) return

      const records = await kvGetMulti(entry.client, items).catch(() => [])
      const updates = new Map<string, MonthlyTraffic>()
      for (const row of records) {
        const cycleId = cycleByUuid.get(row.namespace)
        if (!cycleId) continue
        const record = parseMonthlyTrafficRecord(row.value, cycleId)
        if (!record) continue
        updates.set(monthlyTrafficMapKey(entry.name, row.namespace), toMonthlyTraffic(record))
      }

      if (updates.size) {
        setMonthlyTraffic(prev => {
          const next = new Map(prev)
          for (const [key, value] of updates) next.set(key, value)
          return next
        })
      }
    }

    const bootstrap = async () => {
      const agentsRes = await pool.fanout(listAgentUuids)
      setErrors(prev => [...prev, ...agentsRes.errors])

      const seed = new Map<string, Agent>()
      for (const { source, rows } of agentsRes.ok) {
        const uuids = rows ?? []
        sourceUuids.set(source, uuids)
        for (const uuid of uuids) seed.set(uuid, blankAgent(uuid, source))
      }
      setAgents(seed)

      // 并行获取元数据/静态数据、动态数据、延迟数据
      const metaStaticTask = Promise.all(
        pool.entries.map(async entry => {
          const uuids = sourceUuids.get(entry.name) || []
          if (!uuids.length) return

          const kvItems = uuids.flatMap(u => META_KEYS.map(k => ({ namespace: u, key: k })))
          const [meta, stat] = await Promise.allSettled([
            kvGetMulti(entry.client, kvItems),
            staticDataMulti(entry.client, uuids, STATIC_FIELDS),
          ])

          let metaRows: { namespace: string; key: string; value: unknown }[] = []
          if (meta.status === 'fulfilled' && meta.value) {
            metaRows = meta.value
          } else {
            // 批量请求失败，降级为逐个 key 请求
            const fallback = await Promise.allSettled(
              META_KEYS.map(key =>
                kvGetMulti(
                  entry.client,
                  uuids.map(u => ({ namespace: u, key })),
                ),
              ),
            )
            for (const result of fallback) {
              if (result.status === 'fulfilled' && result.value) {
                metaRows.push(...result.value)
              }
            }
          }

          setAgents(prev => {
            const next = new Map(prev)
            const grouped = new Map<string, Record<string, unknown>>()
            for (const row of metaRows) {
              if (!row || row.value == null) continue
              let bucket = grouped.get(row.namespace)
              if (!bucket) grouped.set(row.namespace, (bucket = {}))
              bucket[row.key] = row.value
            }
            for (const uuid of uuids) {
              const cur = next.get(uuid) ?? blankAgent(uuid, entry.name)
              next.set(uuid, { ...cur, meta: parseMeta(grouped.get(uuid) ?? {}) })
            }
            if (stat.status === 'fulfilled' && stat.value) {
              for (const row of stat.value) {
                if (!row.uuid) continue
                const cur = next.get(row.uuid) ?? blankAgent(row.uuid, entry.name)
                next.set(row.uuid, { ...cur, static: row })
              }
            }
            return next
          })
        }),
      ).finally(() => setMetaHydrated(true))

      // 动态数据首次加载——它决定何时解除 loading
      const dynamicFirstLoad = tickDynamic().then(() => setLoading(false))

      // 延迟数据首次加载——不阻塞 loading，并行跑
      tickLatency().catch(() => {})
      latTimer = setInterval(tickLatency, LATENCY_INTERVAL_MS)

      await Promise.all([metaStaticTask, dynamicFirstLoad])
    }

    const tickDynamic = async () => {
      const updates: DynamicSummary[] = []
      await Promise.allSettled(
        pool.entries.map(async entry => {
          const uuids = sourceUuids.get(entry.name) || []
          if (!uuids.length) return
          try {
            const rows = await dynamicSummaryMulti(entry.client, uuids, DYNAMIC_FIELDS)
            for (const row of rows || []) updates.push(row)
            loadMonthlyTraffic(entry, rows || []).catch(() => {})
          } catch {}
        }),
      )
      if (!updates.length) return

      setLive(prev => {
        const next = new Map(prev)
        for (const row of updates) next.set(row.uuid, row)
        return next
      })
      setHistory(prev => {
        const next = new Map(prev)
        for (const row of updates) {
          const arr = next.get(row.uuid) || []
          const sample = sampleFrom(row)
          const dedup = arr.length && arr[arr.length - 1].t === sample.t ? arr : arr.concat(sample)
          next.set(row.uuid, dedup.slice(-HISTORY_LIMIT))
        }
        return next
      })
    }

    const tickLatency = async () => {
      if (!pool) return
      const now = Date.now()
      const window: [number, number] = [now - 24 * 60 * 60 * 1000, now]
      const updates = new Map<string, LatencyTracks>()

      await Promise.allSettled(
        pool.entries.map(async entry => {
          const uuids = sourceUuids.get(entry.name) || []
          if (!uuids.length) return

          const batchSize = 20
          for (let i = 0; i < uuids.length; i += batchSize) {
            const batch = uuids.slice(i, i + batchSize)
            const results = await Promise.allSettled(
              batch.map(async uuid => {
                const rows = await taskQuery(
                  entry.client,
                  [{ uuid }, { timestamp_from_to: window }, { type: 'ping' }, { limit: 6000 }],
                  LATENCY_QUERY_TIMEOUT,
                )
                const agent = agentsRef.current.get(uuid)
                const region = agent?.meta?.region
                const tracks = buildLatencyTracks(rows, region, 24, 3600000)
                return { uuid, tracks, hasData: rows.length > 0 }
              }),
            )
            for (const r of results) {
              if (r.status === 'fulfilled') {
                updates.set(r.value.uuid, r.value.hasData ? r.value.tracks : {})
              }
            }
          }
        }),
      )

      if (updates.size > 0) {
        setLatencyTracks(prev => new Map([...prev, ...updates]))
      }
    }

    let latTimer: ReturnType<typeof setInterval> | null = null

    bootstrap()
      .catch((e: unknown) => {
        setErrors(prev => [...prev, { source: '*', error: e }])
        setLoading(false)
        // 失败时也要放行，否则骨架屏会一直转
        setMetaHydrated(true)
      })

    const onVisible = () => {
      if (document.visibilityState === 'visible') tickDynamic()
    }
    document.addEventListener('visibilitychange', onVisible)

    const dynTimer = setInterval(tickDynamic, DYN_INTERVAL_MS)
    const clockTimer = setInterval(() => setTick(t => t + 1), 5000)

    return () => {
      clearInterval(dynTimer)
      clearInterval(clockTimer)
      if (latTimer) clearInterval(latTimer)
      document.removeEventListener('visibilitychange', onVisible)
      setPool(null)
      pool.close()
    }
  }, [config])

  const nodes = useMemo(() => {
    const now = Date.now()
    const out = new Map<string, Node>()
    for (const [uuid, a] of agents) {
      const dyn = live.get(uuid) || null
      const traffic = monthlyTraffic.get(monthlyTrafficMapKey(a.source, uuid))
      const trafficLimit = a.meta?.trafficLimit
      const trafficPreview = traffic ? previewMonthlyTraffic(traffic, dyn) : undefined
      const nodeMonthlyTraffic = trafficPreview
        ? {
            ...trafficPreview,
            limit: trafficLimit,
            percent: trafficLimit && trafficLimit > 0 ? (trafficPreview.total / trafficLimit) * 100 : undefined,
          }
        : undefined
      out.set(uuid, {
        ...a,
        dynamic: dyn,
        history: history.get(uuid) || [],
        online: isOnline(dyn?.timestamp, now),
        monthlyTraffic: nodeMonthlyTraffic,
      })
    }
    return out
  }, [agents, live, history, monthlyTraffic, tick])

  return { nodes, errors, loading, pool, latencyTracks, metaHydrated }
}
