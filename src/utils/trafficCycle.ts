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

/** 下一次重置发生的日期，格式 YYYY-MM-DD，用于展示"周期区间"。 */
export function nextCycleStartId(resetDay: number, now: Date = new Date()) {
  const start = cycleStart(now, resetDay)
  const nextMonthIndex0 = start.monthIndex0 === 11 ? 0 : start.monthIndex0 + 1
  const nextYear = start.monthIndex0 === 11 ? start.year + 1 : start.year
  const day = clampDay(nextYear, nextMonthIndex0, clampResetDay(resetDay))
  return fmt(nextYear, nextMonthIndex0, day)
}
