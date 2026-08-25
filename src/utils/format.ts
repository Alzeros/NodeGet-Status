import prettyBytes from 'pretty-bytes'

/** 1–10 TiB 区间用 4 位有效数字（如 1.234 TiB），避免整数截断看不出日增长 */
function formatBytes(n: number) {
  const t = 1024 ** 4
  if (n >= t && n < 10 * t) return `${(n / t).toPrecision(4)} TiB`
  return prettyBytes(n, { binary: true })
}

export function bytes(n?: number | null) {
  return n && n > 0 ? formatBytes(n) : '0 B'
}

export function bytesParts(n?: number | null): { num: string; unit: string } {
  const s = bytes(n)
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
