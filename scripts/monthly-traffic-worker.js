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
const MONTHLY_TRAFFIC_KEY_PREFIX = 'metadata_monthly_traffic:'
const DYNAMIC_FIELDS = ['total_received', 'total_transmitted']

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthlyTrafficKvKey(month) {
  return `${MONTHLY_TRAFFIC_KEY_PREFIX}${month}`
}

function validTotal(value) {
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function trafficDelta(current, previous) {
  if (current == null || previous == null) return 0
  return current >= previous ? current - previous : current
}

function parseRecord(raw, month) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object' || value.month !== month) return null
    return {
      month,
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

function createRecord(row, month, now) {
  return {
    month,
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
  const month = currentMonth()
  const kvKey = monthlyTrafficKvKey(month)
  const now = Date.now()

  const uuidResult = await call('nodeget-server_list_all_agent_uuid', {}, token)
  const uuids = uuidResult?.uuids || []
  if (!uuids.length) {
    return { month, updated: 0, total: 0 }
  }

  const rows = await call('agent_dynamic_summary_multi_last_query', {
    uuids,
    fields: DYNAMIC_FIELDS,
  }, token)

  let updated = 0
  for (const row of rows || []) {
    if (!row?.uuid) continue
    if (validTotal(row.total_received) == null && validTotal(row.total_transmitted) == null) continue

    const raw = await call('kv_get_value', { namespace: row.uuid, key: kvKey }, token).catch(() => null)
    const current = parseRecord(raw, month) ?? createRecord(row, month, now)
    const next = advanceRecord(current, row, now)

    await call('kv_set_value', {
      namespace: row.uuid,
      key: kvKey,
      value: JSON.stringify(next),
    }, token)
    updated++
  }

  return { month, updated, total: uuids.length }
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
