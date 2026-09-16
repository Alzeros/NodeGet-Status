// 流量统计周期：按每台服务器自己的"重置日"（每月几号）切片，而不是日历月。
// 商家的流量重置日通常对齐账单日/购买日，未必是每月 1 号。

function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

function clampDay(year: number, monthIndex0: number, day: number) {
  return Math.min(day, daysInMonth(year, monthIndex0))
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmt(year: number, monthIndex0: number, day: number) {
  return `${year}-${pad(monthIndex0 + 1)}-${pad(day)}`
}

export function clampResetDay(day: number | undefined | null) {
  const d = Math.trunc(Number(day))
  return Number.isFinite(d) && d >= 1 && d <= 31 ? d : 1
}

/**
 * 自然日窗口 id，YYYY-MM-DD。与计费周期无关——「今日流量」要的就是
 * 所有机器共享同一个时间窗，这样榜单才横向可比。
 */
export function localDateId(now: Date = new Date()) {
  return fmt(now.getFullYear(), now.getMonth(), now.getDate())
}

/** 自然月窗口 id，YYYY-MM。「当月流量」同理，不看各家重置日。 */
export function localMonthId(now: Date = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

interface YMD {
  year: number
  monthIndex0: number
  day: number
}

function cycleStart(now: Date, resetDay: number): YMD {
  const rd = clampResetDay(resetDay)
  const year = now.getFullYear()
  const monthIndex0 = now.getMonth()
  const day = now.getDate()
  const thisMonthReset = clampDay(year, monthIndex0, rd)

  if (day >= thisMonthReset) {
    return { year, monthIndex0, day: thisMonthReset }
  }
  const prevMonthIndex0 = monthIndex0 === 0 ? 11 : monthIndex0 - 1
  const prevYear = monthIndex0 === 0 ? year - 1 : year
  return { year: prevYear, monthIndex0: prevMonthIndex0, day: clampDay(prevYear, prevMonthIndex0, rd) }
}

/** 当前流量周期的起始日，格式 YYYY-MM-DD，用作 KV 桶 key 的一部分。 */
export function currentCycleId(resetDay: number, now: Date = new Date()) {
  const { year, monthIndex0, day } = cycleStart(now, resetDay)
  return fmt(year, monthIndex0, day)
}

/** 下一次流量重置发生的绝对时刻，即重置日当天的本地 00:00。 */
export function nextResetTime(resetDay: number, now: Date = new Date()): Date {
  const start = cycleStart(now, resetDay)
  const nextMonthIndex0 = start.monthIndex0 === 11 ? 0 : start.monthIndex0 + 1
  const nextYear = start.monthIndex0 === 11 ? start.year + 1 : start.year
  const day = clampDay(nextYear, nextMonthIndex0, clampResetDay(resetDay))
  return new Date(nextYear, nextMonthIndex0, day, 0, 0, 0, 0)
}

/** 下一次重置发生的日期，格式 YYYY-MM-DD，用于展示"周期区间"。 */
export function nextCycleStartId(resetDay: number, now: Date = new Date()) {
  const next = nextResetTime(resetDay, now)
  return fmt(next.getFullYear(), next.getMonth(), next.getDate())
}

/**
 * 距下次流量重置还有几天，向下取整（剩 12 天 23 小时仍算 12 天）。
 * 只给天级——卡片空间有限，更细的粒度既挤又用不上。
 * 精确重置时刻由 nextResetTime() 提供，需要时挂到 title 上。
 */
export function daysUntilNextReset(resetDay: number, now: Date = new Date()) {
  const ms = nextResetTime(resetDay, now).getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return '即将'
  const days = Math.floor(ms / 86400000)
  // 不带空格：卡片里常在等宽字体旁边混排，多一个空格就可能把整行挤出可视区
  return days >= 1 ? `${days}天` : '不足1天'
}

/**
 * 距下次重置的毫秒数（已重置或非法值返回 0）。
 * 榜单要按紧迫度精确排序——"天"级粒度下剩 5 小时和剩 29 小时同为 0 天，排不出先后。
 */
export function msUntilNextReset(resetDay: number, now: Date = new Date()) {
  const ms = nextResetTime(resetDay, now).getTime() - now.getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/**
 * 倒计时文案，粒度随剩余时间收紧：
 *   >3天    只给天数（剩 26 天还是 25 天，不影响"现在用不用"这个决策）
 *   ≤3天    天 + 小时（开始影响"今天还来不来得及跑完"）
 *   <24小时 小时
 *   <1小时  分钟（降到分钟级才有紧迫感）
 * 不带空格，理由同 daysUntilNextReset。
 */
export function resetCountdownLabel(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '即将'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${Math.max(minutes, 1)}分钟`
  const hours = Math.floor(ms / 3600000)
  if (hours < 24) return `${hours}小时`
  const days = Math.floor(hours / 24)
  if (days <= 3) {
    // 整天数就别缀"0小时"，读起来像噪声
    const rest = hours % 24
    return rest > 0 ? `${days}天${rest}小时` : `${days}天`
  }
  return `${days}天`
}
