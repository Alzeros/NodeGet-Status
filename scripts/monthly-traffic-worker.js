/*
 * NodeGet monthly traffic sampler.
 *
 * Create a JS Worker in the NodeGet controller with this code, for example named:
 * monthly_traffic_sampler
 *
 * Then create a scheduled JS Worker task for that worker. Recommended interval:
 * every 30 minutes.
 */

const DEFAULT_TOKEN = ''
const TRAFFIC_CYCLE_KEY_PREFIX = 'metadata_traffic_cycle:'
const RESET_DAY_KEY = 'metadata_traffic_reset_day'
const DYNAMIC_FIELDS = ['total_received', 'total_transmitted']

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

function resolveToken(params = {}, env = {}) {
  return params.token || env.DEFAULT_TOKEN || DEFAULT_TOKEN
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

  let updated = 0
  for (const row of rows || []) {
    if (!row?.uuid) continue
    if (validTotal(row.total_received) == null && validTotal(row.total_transmitted) == null) continue

    const resetDay = resetDayByUuid.get(row.uuid) ?? 1
    const cycleId = currentCycleId(resetDay, nowDate)
    const kvKey = trafficCycleKvKey(cycleId)

    const raw = await call('kv_get_value', { namespace: row.uuid, key: kvKey }, token).catch(() => null)
    const current = parseRecord(raw, cycleId) ?? createRecord(row, cycleId, now)
    const next = advanceRecord(current, row, now)

    await call('kv_set_value', {
      namespace: row.uuid,
      key: kvKey,
      value: JSON.stringify(next),
    }, token)
    updated++
  }

  return { updated, total: uuids.length }
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
