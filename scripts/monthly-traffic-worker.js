/*
 * NodeGet traffic sampler.
 *
 * Create a JS Worker in the NodeGet controller with this code, for example named:
 * monthly_traffic_sampler
 *
 * Then create a scheduled JS Worker task for that worker. Recommended interval:
 * every 30 minutes.
 *
 * 每次采样写三个 KV：
 *   metadata_traffic_cycle:<周期起始日>  按各机器自己的重置日切片，供额度/剩余量展示
 *   metadata_traffic_window             UTC+8 日窗口 + 原主控本地自然月窗口
 *   metadata_traffic_daily_utc8          已结束的 UTC+8 日用量，供每日流量柱状图
 * 日桶按午夜快照拆分；历史用主控保留的动态数据回填。旧 day / 旧每日历史不参与新版统计。
 */

const DEFAULT_TOKEN = ''
const TRAFFIC_CYCLE_KEY_PREFIX = 'metadata_traffic_cycle:'
// 自然日/自然月窗口。跟计费周期是两套口径：周期桶回答"这台快超额没"，
// 窗口桶回答"今天/本月谁跑得多"——所有机器共享同一时间窗，榜单才横向可比。
// 窗口仍放在同一个 key；dayUtc8 固定 UTC+8，month 保持主控本地时区。
const TRAFFIC_WINDOW_KEY = 'metadata_traffic_window'
const RESET_DAY_KEY = 'metadata_traffic_reset_day'
// 每日历史：跨天时把前一天的自然日窗口结果归档进 days；空缺的日期用
// agent_query_dynamic_summary 取相邻两个午夜的计数器做差回填（主控默认只保留 3~4 周动态数据）。
// 整段历史放一个 key：前端一台读一次就够，不用按日期拼 key。
const TRAFFIC_DAILY_KEY = 'metadata_traffic_daily_utc8'
const DAY_TIME_ZONE = 'UTC+08:00'
const DAY_OFFSET_MS = 8 * 3600000
// 午夜值只是在采样精度内的近似；超出 5 分钟的旧记录不能充当边界。
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000
// 最近两个已结束日依赖的午夜仍可能迟到；更老的真实缺失保持负缓存。
const SNAPSHOT_RETRY_DAYS = 2
// 历史保留天数，够画一个季度
const DAILY_KEEP_DAYS = 92
// 只回填这个范围内的缺口，再往前主控也没有数据了
const BACKFILL_DAYS = 31
// 每台机器每轮最多查几个午夜快照：首次部署 32 个午夜分 3 轮补完，单轮 cron 不至于拖太长
const BACKFILL_FETCH_PER_RUN = 12
const DYNAMIC_FIELDS = ['total_received', 'total_transmitted']
// 写回时的并发度：节点多时串行跑会把 cron 窗口拖满
const WRITE_CONCURRENCY = 10
// 批量读的分片大小（节点数）：每台读 3 个 key，分片是为了限制单个请求体积
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

function utc8DateId(now) {
  return new Date(now.getTime() + DAY_OFFSET_MS).toISOString().slice(0, 10)
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

function validDayId(id) {
  return typeof id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(id) && shiftDayId(id, 0) === id
}

function parseDayWindow(value) {
  const window = parseWindow(value)
  if (!window || !validDayId(window.id)) return null
  if (value.partial || value.reset) window.partial = true
  if (value.reset) window.reset = true
  if (Number.isSafeInteger(value.revision) && value.revision > 0) window.revision = value.revision
  // 内部来源：last* 是每方向最后有效值；_sample 才表示同一时刻的完整样本。
  window._sample = value._sample === undefined
    ? { received: window.lastReceived, transmitted: window.lastTransmitted, ts: window.updatedAt }
    : value._sample
  if (value._start) window._start = value._start
  if (value._gaps) window._gaps = true
  if (value._closed) window._closed = true
  return window
}

/** 日窗口修订号与采样时刻独立；载荷变化才升版，忽略 revision 自身和顶层属性顺序。 */
function reviseDayWindow(previous, next) {
  if (!next) return next
  const sameDay = previous?.id === next.id
  const changed = !sameDay || Object.keys({ ...previous, ...next }).some(key =>
    key !== 'revision' && JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
  const revision = sameDay && previous.revision ? previous.revision + (changed ? 1 : 0) : 1
  return { ...next, revision }
}

function parseWindows(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object') return {}
    // 旧 day 只保留，不作为 UTC+8 的基线，也不继续写入旧口径。
    return { day: value.day, dayUtc8: parseDayWindow(value.dayUtc8), month: parseWindow(value.month) }
  } catch {
    return {}
  }
}

/** 自然月维持原有口径：跨月重新起桶，继承上一桶基线，采样间隔整段记入新月。 */
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

/** UTC 日历运算，不受宿主时区或夏令时影响。 */
function shiftDayId(id, delta) {
  const [y, m, d] = id.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

/** 日期 id 当天的 UTC+8 零点。 */
function midnightTs(id) {
  const [y, m, d] = id.split('-').map(Number)
  return Date.UTC(y, m - 1, d) - DAY_OFFSET_MS
}

/**
 * metadata_traffic_daily_utc8 的结构（timeZone 固定 UTC+08:00）：
 *   days      { 'YYYY-MM-DD': { received, transmitted, partial?, reset?, source? } }  已结束的自然日
 *   snapshots { 'YYYY-MM-DD': { received, transmitted, ts } | null }              合规午夜样本；近期 null 可重试
 *   _pending  { 'YYYY-MM-DD': dayUtc8 }                                           内部恢复锚点；_closed 表示已定稿边界
 * dayUtc8 内部字段：_sample=同一时刻完整样本/null，_start=待补午夜的原始基线，_gaps=缺方向标记。
 */
function parseDaily(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || value.timeZone !== DAY_TIME_ZONE || !value.days || typeof value.days !== 'object') return null
    return {
      timeZone: DAY_TIME_ZONE,
      days: { ...value.days },
      snapshots: value.snapshots && typeof value.snapshots === 'object' ? { ...value.snapshots } : {},
      // _pending 保存未闭合或尚待发布的日窗口，历史写成功后它是失败重跑的权威锚点。
      _pending: Object.fromEntries(Object.entries(value._pending || {})
        .filter(([id, window]) => validDayId(id) && window?.id === id && parseDayWindow(window))
        .map(([id, window]) => [id, parseDayWindow(window)])),
    }
  } catch {
    return null
  }
}

/** 日桶只消费时间向前的真实样本；重置或缺字段造成的缺口不能伪装成完整日。 */
function advanceDayWindow(prev, row) {
  if (!validTimestamp(row.timestamp) || row.timestamp <= prev.updatedAt) return prev
  const received = validTotal(row.total_received)
  const transmitted = validTotal(row.total_transmitted)
  const reset = (received != null && prev.lastReceived != null && received < prev.lastReceived)
    || (transmitted != null && prev.lastTransmitted != null && transmitted < prev.lastTransmitted)
  return {
    ...prev,
    received: prev.received + trafficDelta(received, prev.lastReceived),
    transmitted: prev.transmitted + trafficDelta(transmitted, prev.lastTransmitted),
    // 跨缺字段保留计数器，才能识别恢复上报后的回退；完整样本来源另存，不能混用。
    lastReceived: received ?? prev.lastReceived,
    lastTransmitted: transmitted ?? prev.lastTransmitted,
    _sample: received != null && transmitted != null ? { received, transmitted, ts: row.timestamp } : null,
    updatedAt: row.timestamp,
    ...(received == null || transmitted == null ? { _gaps: true } : {}),
    ...(reset ? { reset: true } : {}),
    ...(reset || received == null || transmitted == null ? { partial: true } : {}),
  }
}

function archiveFinishedDay(daily, prevDay) {
  const existing = daily.days[prevDay.id]
  // 完整快照可补齐普通采样缺口，但不能抹掉任何已经观察到的重置。
  if (existing?.reset && !prevDay.reset) return
  if (existing && !existing.partial && prevDay.partial && !prevDay.reset) return
  const entry = { received: prevDay.received, transmitted: prevDay.transmitted }
  if (prevDay.partial) entry.partial = true
  if (prevDay.reset) entry.reset = true
  daily.days[prevDay.id] = entry
}

function validTimestamp(ts) {
  return Number.isFinite(ts) && Number.isFinite(new Date(ts).getTime())
}

function validSnapshot(snapshot, boundary) {
  return snapshot && validTimestamp(snapshot.ts)
    && snapshot.ts <= boundary && boundary - snapshot.ts <= SNAPSHOT_MAX_AGE_MS
    && validTotal(snapshot.received) != null && validTotal(snapshot.transmitted) != null
}

/** timestamp_to + last 取边界前最后一条，不代表它恰好落在午夜。 */
async function fetchSnapshot(uuid, ts, token) {
  const rows = await call('agent_query_dynamic_summary', {
    query: { fields: DYNAMIC_FIELDS, condition: [{ uuid }, { timestamp_to: ts }, { last: null }] },
  }, token)
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null
  const snapshot = { received: row.total_received, transmitted: row.total_transmitted, ts: row.timestamp }
  return validSnapshot(snapshot, ts) ? snapshot : null
}

/** 首日基线、旧桶结束边界、回填共享每节点每轮预算；错误不落 null，留给次轮重试。 */
function snapshotLoader(daily, uuid, token, dayId) {
  let fetched = 0
  let failed = false
  const seen = new Set()
  const retryFrom = shiftDayId(dayId, -SNAPSHOT_RETRY_DAYS)
  return async id => {
    let cached = daily.snapshots[id]
    if (cached !== undefined && !validSnapshot(cached, midnightTs(id))) cached = daily.snapshots[id] = null
    if (cached) {
      seen.add(id)
      return cached
    }
    if (seen.has(id) || (cached === null && id < retryFrom)) return cached
    if (failed || fetched >= BACKFILL_FETCH_PER_RUN) return undefined
    seen.add(id)
    fetched++
    try {
      return daily.snapshots[id] = await fetchSnapshot(uuid, midnightTs(id), token)
    } catch {
      // 包括重试 null 失败：不把 RPC 错误解释为永久查无。
      delete daily.snapshots[id]
      failed = true
      return undefined
    }
  }
}

/** 首次午夜失败后的同日补偿；保留最初锚点，避免稍后已追平的计数器掩盖早先重置。 */
async function repairDayStart(prev, getSnapshot) {
  if (!prev._start || prev.reset) return prev
  const start = await getSnapshot(prev.id)
  if (!start) return prev
  if (prev._start.received < start.received || prev._start.transmitted < start.transmitted
    || prev.lastReceived < start.received || prev.lastTransmitted < start.transmitted) {
    return { ...prev, partial: true, reset: true }
  }
  const next = {
    ...prev,
    received: trafficDelta(prev.lastReceived, start.received),
    transmitted: trafficDelta(prev.lastTransmitted, start.transmitted),
    // 该方向仍未上报时，午夜值必须留作下一次有效计数器的比较锚点。
    // _sample 仍保持真实完整样本/null，不把这里补入的历史基线冒充当前样本。
    lastReceived: prev.lastReceived ?? start.received,
    lastTransmitted: prev.lastTransmitted ?? start.transmitted,
    startedAt: midnightTs(prev.id),
  }
  delete next._start
  if (!next._gaps && validTotal(next.lastReceived) != null && validTotal(next.lastTransmitted) != null) delete next.partial
  return next
}

/** 修订一个共享快照时，其端点差来源的邻日必须重新计算，不能只改一侧。 */
function saveBoundary(daily, id, snapshot) {
  const previous = daily.snapshots[id]
  if (previous && (previous.ts !== snapshot.ts || previous.received !== snapshot.received || previous.transmitted !== snapshot.transmitted)) {
    for (const day of [shiftDayId(id, -1), id]) {
      if (daily.days[day]?.source === 'snapshot' && !daily.days[day].reset) delete daily.days[day]
    }
  }
  daily.snapshots[id] = snapshot
}

async function finishDay(daily, prev, getSnapshot) {
  prev = await repairDayStart(prev, getSnapshot)
  const endId = shiftDayId(prev.id, 1)
  let end = await getSnapshot(endId)
  const last = prev._sample
  // 已持久化的完整样本本身就是边界候选，不依赖历史 RPC 成功。
  if (last?.ts === prev.updatedAt && validSnapshot(last, midnightTs(endId)) && (!end || last.ts >= end.ts)) {
    end = last
  } else if (end && end.ts <= prev.updatedAt) {
    end = null
    delete daily.snapshots[endId]
  }
  if (end) {
    saveBoundary(daily, endId, end)
    prev = { ...advanceDayWindow(prev, { timestamp: end.ts, total_received: end.received, total_transmitted: end.transmitted }), _closed: true }
  }
  // 不用日总量 max 合并；持久化原始窗口锚点，重跑继续推进同一累计来源。
  daily._pending[prev.id] = prev
  archiveFinishedDay(daily, end ? prev : { ...prev, partial: true })
  return prev
}

async function updateDayWindow(daily, prev, dayId, row, observedAt, getSnapshot) {
  const rowDay = validTimestamp(row.timestamp) && row.timestamp <= observedAt ? utc8DateId(new Date(row.timestamp)) : null
  // 先闭合此前失败的桶；已发布历史的闭合锚点不可被旧窗口或迟到旧样本回退。
  for (const [id, pending] of Object.entries(daily._pending)) {
    if (pending._closed) {
      if (id !== prev?.id) delete daily._pending[id]
    } else if (id < dayId) {
      await finishDay(daily, rowDay === id ? advanceDayWindow(pending, row) : pending, getSnapshot)
    }
  }
  if (prev && daily._pending[prev.id]) {
    prev = daily._pending[prev.id]
  } else if (prev) {
    if (rowDay === prev.id) prev = advanceDayWindow(prev, row)
    if (prev.id < dayId) prev = await finishDay(daily, prev, getSnapshot)
  }
  if (rowDay !== dayId) return prev
  if (prev?.id === dayId) return repairDayStart(prev, getSnapshot)
  const start = await getSnapshot(dayId)
  const baseline = start ?? { received: validTotal(row.total_received), transmitted: validTotal(row.total_transmitted), ts: row.timestamp }
  const base = {
    id: dayId,
    received: 0,
    transmitted: 0,
    lastReceived: baseline.received,
    lastTransmitted: baseline.transmitted,
    _sample: baseline.received != null && baseline.transmitted != null ? baseline : null,
    startedAt: start ? midnightTs(dayId) : row.timestamp,
    updatedAt: baseline.ts,
    ...(!start ? { partial: true, _start: baseline } : {}),
    ...(baseline.received == null || baseline.transmitted == null ? { partial: true, _gaps: true } : {}),
  }
  return advanceDayWindow(base, row)
}

/** 最近 BACKFILL_DAYS 天由相邻两个合规午夜快照做差；重置日不由端点差覆盖。 */
async function backfillDaily(daily, dayId, getSnapshot) {
  for (let k = 1; k <= BACKFILL_DAYS; k++) {
    const id = shiftDayId(dayId, -k)
    const existing = daily.days[id]
    if (existing && (!existing.partial || existing.reset)) continue
    const from = await getSnapshot(id)
    const to = await getSnapshot(shiftDayId(id, 1))
    if (!from || !to) continue
    const entry = {
      received: trafficDelta(to.received, from.received),
      transmitted: trafficDelta(to.transmitted, from.transmitted),
      source: 'snapshot',
    }
    // 端点可检测到的回退：只取重置后累计值，明确不是完整日。
    if (to.received < from.received || to.transmitted < from.transmitted) {
      entry.received = to.received
      entry.transmitted = to.transmitted
      entry.reset = true
      entry.partial = true
    }
    daily.days[id] = entry
  }
}

/** 裁掉过老的历史和快照；id 是 YYYY-MM-DD，字符串比较即日期比较 */
function pruneDaily(daily, dayId, activeDay) {
  const minDay = shiftDayId(dayId, -DAILY_KEEP_DAYS)
  const minSnapshot = shiftDayId(dayId, -(BACKFILL_DAYS + 1))
  for (const id of Object.keys(daily.days)) {
    if (id < minDay || id >= dayId) delete daily.days[id]
  }
  for (const id of Object.keys(daily._pending)) {
    if (id !== activeDay?.id && (id < minDay || id >= dayId)) delete daily._pending[id]
  }
  const required = new Set()
  for (const id of [...Object.keys(daily._pending), ...(activeDay ? [activeDay.id] : [])]) {
    required.add(id)
    required.add(shiftDayId(id, 1))
  }
  for (const id of Object.keys(daily.snapshots)) {
    if (id < minSnapshot && !required.has(id)) delete daily.snapshots[id]
  }
}

function resolveToken(params = {}, env = {}) {
  return params.token || env.DEFAULT_TOKEN || DEFAULT_TOKEN
}

/** 报错前等待所有已启动分支，防止 onCall 返回后仍有旧窗口写入覆盖重试。 */
async function settleAll(promises) {
  let failed = false
  let failure
  await Promise.all(promises.map(promise => promise.catch(error => {
    if (!failed) { failed = true; failure = error }
  })))
  if (failed) throw failure
}

/** 按并发度分批跑，避免节点多时把 cron 窗口拖满，也不至于一次打爆主控 */
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await settleAll(items.slice(i, i + size).map(fn))
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
  // 日口径使用动态数据取回后的观察时刻；月与计费周期继续使用原轮次起点。
  const observedAt = Date.now()
  const dayId = utc8DateId(new Date(observedAt))

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
        { namespace: t.row.uuid, key: TRAFFIC_DAILY_KEY },
      ]),
    }, token)
    // 靠记录结构认领（历史有 timeZone/days，窗口有 day/dayUtc8/month，周期桶有 cycleId），不依赖后端回显 KV key——
    // 认不出来就等于丢基线，代价和读失败一样大
    for (const r of storedRows || []) {
      const t = r && r.namespace ? targetByUuid.get(r.namespace) : null
      if (!t) continue
      const daily = parseDaily(r.value)
      if (daily) {
        t.daily = daily
        continue
      }
      const windows = parseWindows(r.value)
      if (windows.day || windows.dayUtc8 || windows.month) {
        t.windows = windows
        continue
      }
      const cycle = parseRecord(r.value, t.cycleId)
      if (cycle) t.cycleRecord = cycle
    }
  }

  let updated = 0
  let dailyUpdated = 0
  await inBatches(targets, WRITE_CONCURRENCY, async ({ row, cycleId, cycleKey, cycleRecord, windows, daily }) => {
    const nextCycle = advanceRecord(cycleRecord ?? createRecord(row, cycleId, now), row, now)

    const prev = windows || {}
    const nextDaily = daily ?? { timeZone: DAY_TIME_ZONE, days: {}, snapshots: {}, _pending: {} }
    const dailyBefore = JSON.stringify(nextDaily)
    const getSnapshot = snapshotLoader(nextDaily, row.uuid, token, dayId)
    const dayUtc8 = reviseDayWindow(prev.dayUtc8,
      await updateDayWindow(nextDaily, prev.dayUtc8, dayId, row, observedAt, getSnapshot))
    const nextWindows = {
      ...(prev.day ? { day: prev.day } : {}),
      ...(dayUtc8 ? { dayUtc8 } : {}),
      month: advanceWindow(prev.month, monthId, row, now),
    }

    await backfillDaily(nextDaily, dayId, getSnapshot)
    pruneDaily(nextDaily, dayId, dayUtc8)
    const dailyChanged = !daily || JSON.stringify(nextDaily) !== dailyBefore

    await settleAll([
      call('kv_set_value', {
        namespace: row.uuid,
        key: cycleKey,
        value: JSON.stringify(nextCycle),
      }, token),
      (async () => {
        // 归档落盘后才发布新日；历史失败也独立保存月桶，但日字段保持已发布版本。
        let historyError
        if (dailyChanged) {
          try {
            await call('kv_set_value', {
              namespace: row.uuid,
              key: TRAFFIC_DAILY_KEY,
              value: JSON.stringify({ ...nextDaily, updatedAt: observedAt }),
            }, token)
          } catch (error) {
            historyError = error
          }
        }
        await call('kv_set_value', {
          namespace: row.uuid,
          key: TRAFFIC_WINDOW_KEY,
          value: JSON.stringify(historyError ? { ...prev, month: nextWindows.month } : nextWindows),
        }, token)
        if (historyError) throw historyError
      })(),
    ])
    updated++
    if (dailyChanged) dailyUpdated++
  })

  return { updated, dailyUpdated, total: uuids.length, dayId, monthId }
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
