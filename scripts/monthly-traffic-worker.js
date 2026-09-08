/*
 * NodeGet traffic sampler.
 *
 * Create a JS Worker in the NodeGet controller with this code, for example named:
 * monthly_traffic_sampler
 *
 * Then create a scheduled JS Worker task for that worker. Recommended interval:
 * every 30 minutes.
 *
 * 每次采样写两个 KV：
 *   metadata_traffic_cycle:<周期起始日>  按各机器自己的重置日切片，供额度/剩余量展示
 *   metadata_traffic_window             自然日 + 自然月两个窗口，供跨机器可比的流量榜单
 * 窗口桶是后加的，只从本 worker 更新后开始累计，历史数据无法回填。
 */

const DEFAULT_TOKEN = ''
const TRAFFIC_CYCLE_KEY_PREFIX = 'metadata_traffic_cycle:'
// 自然日/自然月窗口。跟计费周期是两套口径：周期桶回答"这台快超额没"，
// 窗口桶回答"今天/本月谁跑得多"——所有机器共享同一时间窗，榜单才横向可比。
// 两个窗口塞进同一个 key：读写各一次，且窗口 id 由主控（而非浏览器）写定，
// 前端不必猜主控在哪个时区。
const TRAFFIC_WINDOW_KEY = 'metadata_traffic_window'
const RESET_DAY_KEY = 'metadata_traffic_reset_day'
const DYNAMIC_FIELDS = ['total_received', 'total_transmitted']
// 写回时的并发度：节点多时串行跑会把 cron 窗口拖满
const WRITE_CONCURRENCY = 10
// 批量读的分片大小（节点数）：每台读 2 个 key，分片是为了限制单个请求体积
const READ_CHUNK = 100

// 流量统计周期：按每台服务器自己的"重置日"（每月几号）切片，而不是日历月。
// 商家的流量重置日通常对齐账单日/购买日，未必是每月 1 号。
function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

function clampDay(year, monthIndex0, day) {
  return Math.min(day, daysInMonth(year, monthIndex0))
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function fmt(year, monthIndex0, day) {
  return `${year}-${pad(monthIndex0 + 1)}-${pad(day)}`
}

function clampResetDay(day) {
  const d = Math.trunc(Number(day))
  return Number.isFinite(d) && d >= 1 && d <= 31 ? d : 1
}

function currentCycleId(resetDay, now) {
  const rd = clampResetDay(resetDay)
  const year = now.getFullYear()
  const monthIndex0 = now.getMonth()
  const day = now.getDate()
  const thisMonthReset = clampDay(year, monthIndex0, rd)

  if (day >= thisMonthReset) {
    return fmt(year, monthIndex0, thisMonthReset)
  }
  const prevMonthIndex0 = monthIndex0 === 0 ? 11 : monthIndex0 - 1
  const prevYear = monthIndex0 === 0 ? year - 1 : year
  return fmt(prevYear, prevMonthIndex0, clampDay(prevYear, prevMonthIndex0, rd))
}

function trafficCycleKvKey(cycleId) {
  return `${TRAFFIC_CYCLE_KEY_PREFIX}${cycleId}`
}

function localDateId(now) {
  return fmt(now.getFullYear(), now.getMonth(), now.getDate())
}

function localMonthId(now) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

function validTotal(value) {
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function trafficDelta(current, previous) {
  if (current == null || previous == null) return 0
  // 计数器回退（重启/网卡重置）：丢弃这段间隙，避免把重启前后的用量叠加虚高。
  return current >= previous ? current - previous : 0
}

function parseRecord(raw, cycleId) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object' || value.cycleId !== cycleId) return null
    return {
      cycleId,
      received: Number(value.received) || 0,
      transmitted: Number(value.transmitted) || 0,
      lastReceived: Number.isFinite(value.lastReceived) ? Number(value.lastReceived) : undefined,
      lastTransmitted: Number.isFinite(value.lastTransmitted) ? Number(value.lastTransmitted) : undefined,
      startedAt: Number(value.startedAt) || Date.now(),
      updatedAt: Number(value.updatedAt) || 0,
    }
  } catch {
    return null
  }
}

function createRecord(row, cycleId, now) {
  return {
    cycleId,
    received: 0,
    transmitted: 0,
    lastReceived: validTotal(row.total_received),
    lastTransmitted: validTotal(row.total_transmitted),
    startedAt: now,
    updatedAt: now,
  }
}

function advanceRecord(record, row, now) {
  const currentReceived = validTotal(row.total_received)
  const currentTransmitted = validTotal(row.total_transmitted)
  return {
    ...record,
    received: record.received + trafficDelta(currentReceived, record.lastReceived),
    transmitted: record.transmitted + trafficDelta(currentTransmitted, record.lastTransmitted),
    lastReceived: currentReceived ?? record.lastReceived,
    lastTransmitted: currentTransmitted ?? record.lastTransmitted,
    updatedAt: now,
  }
}

function parseWindow(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) return null
  return {
    id: value.id,
    received: Number(value.received) || 0,
    transmitted: Number(value.transmitted) || 0,
    lastReceived: Number.isFinite(value.lastReceived) ? Number(value.lastReceived) : undefined,
    lastTransmitted: Number.isFinite(value.lastTransmitted) ? Number(value.lastTransmitted) : undefined,
    startedAt: Number(value.startedAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || 0,
  }
}

function parseWindows(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object') return {}
    return { day: parseWindow(value.day), month: parseWindow(value.month) }
  } catch {
    return {}
  }
}

/**
 * 推进一个统计窗口。窗口 id 变了（跨日/跨月）就重新起桶，但基线继承上一个桶的
 * lastReceived —— 采样间隔横跨零点的那段流量会记进新窗口，不丢也不重复计。
 * 这也是窗口桶不按日期拆 key 的原因：上一桶的基线就在同一条记录里，零成本拿到。
 */
function advanceWindow(prev, id, row, now) {
  const currentReceived = validTotal(row.total_received)
  const currentTransmitted = validTotal(row.total_transmitted)
  const base =
    prev && prev.id === id
      ? prev
      : {
          id,
          received: 0,
          transmitted: 0,
          lastReceived: prev?.lastReceived,
          lastTransmitted: prev?.lastTransmitted,
          startedAt: now,
        }
  return {
    id,
    received: base.received + trafficDelta(currentReceived, base.lastReceived),
    transmitted: base.transmitted + trafficDelta(currentTransmitted, base.lastTransmitted),
    lastReceived: currentReceived ?? base.lastReceived,
    lastTransmitted: currentTransmitted ?? base.lastTransmitted,
    startedAt: base.startedAt,
    updatedAt: now,
  }
}

function resolveToken(params = {}, env = {}) {
  return params.token || env.DEFAULT_TOKEN || DEFAULT_TOKEN
}

/** 按并发度分批跑，避免节点多时把 cron 窗口拖满，也不至于一次打爆主控 */
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

async function call(method, params = {}, token = DEFAULT_TOKEN) {
  if (typeof nodeget !== 'function') {
    throw new Error('nodeget injected API is not available')
  }
  if (!token) {
    throw new Error('Missing token. Pass {"token":"..."} in task parameters or set DEFAULT_TOKEN in the script.')
  }
  const response = await nodeget(method, { token, ...params })
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(`${method}: ${response.error.message || 'RPC error'} ${response.error.data || ''}`)
  }
  if (response && typeof response === 'object' && 'result' in response) {
    return response.result
  }
  return response
}

function simplify(value) {
  try {
    const text = JSON.stringify(value)
    return JSON.parse(text.length > 1200 ? `${text.slice(0, 1200)}..."` : text)
  } catch {
    return String(value)
  }
}

async function rawCall(method, params, omitParams) {
  try {
    const value = omitParams ? await nodeget(method) : await nodeget(method, params)
    return { ok: true, value: simplify(value) }
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
}

async function debugProbe() {
  const listNoParams = await rawCall('nodeget-server_list_all_agent_uuid', undefined, true)
  const listEmptyParams = await rawCall('nodeget-server_list_all_agent_uuid', {}, false)
  const listNullParams = await rawCall('nodeget-server_list_all_agent_uuid', null, false)

  return {
    nodegetType: typeof nodeget,
    listNoParams,
    listEmptyParams,
    listNullParams,
  }
}

async function debugProbeWithToken(params = {}, env = {}) {
  const token = resolveToken(params, env)
  return {
    hasToken: !!token,
    listWithToken: token
      ? await rawCall('nodeget-server_list_all_agent_uuid', { token }, false)
      : { ok: false, error: 'missing token' },
  }
}

async function syncMonthlyTraffic(params = {}, env = {}) {
  const token = resolveToken(params, env)
  const now = Date.now()
  const nowDate = new Date(now)
  const dayId = localDateId(nowDate)
  const monthId = localMonthId(nowDate)

  const uuidResult = await call('nodeget-server_list_all_agent_uuid', {}, token)
  const uuids = uuidResult?.uuids || []
  if (!uuids.length) {
    return { updated: 0, total: 0 }
  }

  const [rows, resetDayRows] = await Promise.all([
    call('agent_dynamic_summary_multi_last_query', { uuids, fields: DYNAMIC_FIELDS }, token),
    call('kv_get_multi_value', {
      namespace_key: uuids.map(uuid => ({ namespace: uuid, key: RESET_DAY_KEY })),
    }, token).catch(() => []),
  ])

  const resetDayByUuid = new Map()
  for (const r of resetDayRows || []) {
    if (r && r.namespace) resetDayByUuid.set(r.namespace, clampResetDay(r.value))
  }

  // 有效计数器的节点才处理；顺手算出各自的周期 key
  const targets = []
  for (const row of rows || []) {
    if (!row?.uuid) continue
    if (validTotal(row.total_received) == null && validTotal(row.total_transmitted) == null) continue
    const resetDay = resetDayByUuid.get(row.uuid) ?? 1
    const cycleId = currentCycleId(resetDay, nowDate)
    targets.push({ row, cycleId, cycleKey: trafficCycleKvKey(cycleId) })
  }
  if (!targets.length) {
    return { updated: 0, total: uuids.length }
  }

  // 旧记录批量读回：原先每台一次 kv_get_value 串行拉，节点一多就是几百次往返。
  // 读失败一律往外抛、整轮不写：把读失败当成"没有记录"会拿当前计数器重建基线，
  // 等于把所有机器已累计的用量清零。分片同理——单个巨型请求失败面太大。
  const targetByUuid = new Map(targets.map(t => [t.row.uuid, t]))
  for (let i = 0; i < targets.length; i += READ_CHUNK) {
    const chunk = targets.slice(i, i + READ_CHUNK)
    const storedRows = await call('kv_get_multi_value', {
      namespace_key: chunk.flatMap(t => [
        { namespace: t.row.uuid, key: t.cycleKey },
        { namespace: t.row.uuid, key: TRAFFIC_WINDOW_KEY },
      ]),
    }, token)
    // 靠记录结构认领（窗口有 day/month，周期桶有 cycleId），不依赖后端回显 KV key——
    // 认不出来就等于丢基线，代价和读失败一样大
    for (const r of storedRows || []) {
      const t = r && r.namespace ? targetByUuid.get(r.namespace) : null
      if (!t) continue
      const windows = parseWindows(r.value)
      if (windows.day || windows.month) {
        t.windows = windows
        continue
      }
      const cycle = parseRecord(r.value, t.cycleId)
      if (cycle) t.cycleRecord = cycle
    }
  }

  let updated = 0
  await inBatches(targets, WRITE_CONCURRENCY, async ({ row, cycleId, cycleKey, cycleRecord, windows }) => {
    const nextCycle = advanceRecord(cycleRecord ?? createRecord(row, cycleId, now), row, now)

    const prev = windows || {}
    const nextWindows = {
      day: advanceWindow(prev.day, dayId, row, now),
      month: advanceWindow(prev.month, monthId, row, now),
    }

    await Promise.all([
      call('kv_set_value', {
        namespace: row.uuid,
        key: cycleKey,
        value: JSON.stringify(nextCycle),
      }, token),
      call('kv_set_value', {
        namespace: row.uuid,
        key: TRAFFIC_WINDOW_KEY,
        value: JSON.stringify(nextWindows),
      }, token),
    ])
    updated++
  })

  return { updated, total: uuids.length, dayId, monthId }
}

export default {
  async onCall(params, env, ctx) {
    if (params?.debug) return debugProbe()
    if (params?.debugToken) return debugProbeWithToken(params, env)
    try {
      return await syncMonthlyTraffic(params, env)
    } catch (error) {
      return { ok: false, error: error?.message || String(error), params }
    }
  },

  async onCron(params, env, ctx) {
    if (params?.debug) return debugProbe()
    if (params?.debugToken) return debugProbeWithToken(params, env)
    return syncMonthlyTraffic(params, env)
  },

  async onRoute(request, env, ctx) {
    const url = new URL(request.url)
    const token = url.searchParams.get('token') || request.headers.get('x-nodeget-token') || env?.DEFAULT_TOKEN || undefined
    const result = await syncMonthlyTraffic({ token })
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  },
}
