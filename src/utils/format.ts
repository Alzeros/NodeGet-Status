import prettyBytes from 'pretty-bytes'

const GiB = 1024 ** 3

/**
 * `precise` 只在全局汇总处开：1–10 TiB 区间保留 4 位有效数字（如 1.235 TiB），
 * 便于观察日增长。卡片等空间紧张处不要开——1 TiB 会被撑成 "1.000 TiB"，白白多吃三个字符。
 *
 * GiB 段（≥1 GiB 且 <1 TiB）不走 prettyBytes：它固定 3 位有效数字，
 * 四位数的 GiB 值（1000~1023）会被压到 10 GiB 粒度——1013 显示 1010、
 * 涨过 1015 直接跳 1020，主数字与 ↑↓ 分项加总永远差好几个 G。
 * 这里直接舍弃小数取整 GiB，粒度 1 GiB，分项相加与主数字最多差 1。
 */
function formatBytes(n: number, precise = false) {
  const t = 1024 ** 4
  if (precise && n >= t && n < 10 * t) return `${(n / t).toPrecision(4)} TiB`
  if (precise && n >= GiB) return `${Math.floor(n / GiB)} GiB`
  return prettyBytes(n, { binary: true })
}

export function bytes(n?: number | null) {
  return n && n > 0 ? formatBytes(n) : '0 B'
}

/** 拆分数字与单位供排版用。全局统计专用，带高精度。 */
export function bytesParts(n?: number | null): { num: string; unit: string } {
  const s = n && n > 0 ? formatBytes(n, true) : '0 B'
  const m = s.match(/^([\d.]+)\s*(.*)$/)
  if (m) return { num: m[1], unit: m[2] }
  return { num: s, unit: '' }
}

export function pct(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(1)}%`
}

export function uptime(seconds?: number | null) {
  if (!seconds || seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d}天 ${h}小时`
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}小时 ${m}分`
}

export function relativeAge(ts?: number | null, now = Date.now()) {
  if (!ts) return '从未'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  return `${Math.round(s / 3600)} 小时前`
}
