/**
 * 币种折算：把各节点的 priceUnit 统一折算到占比最高的币种，成本排行才有可比性。
 * 汇率源：frankfurter.dev（ECB 数据，免费无 key，CORS 开放）。
 * 缓存策略：localStorage 存 24h；过期前静默使用缓存，过期后拉新失败也回退缓存，
 * 都没有再用内置兜底值——探针页不该因为汇率接口挂了而白屏。
 */

const CACHE_KEY = 'nodeget.fxRates'
const CACHE_TTL = 24 * 60 * 60 * 1000
const API = 'https://api.frankfurter.dev/v1/latest?base=USD'

/** priceUnit 符号 → ISO 4217 代码。未知符号按原样当代码用（如直接写 "CNY"）。 */
export function currencyCode(unit: string): string {
  const map: Record<string, string> = {
    $: 'USD',
    '＄': 'USD',
    '¥': 'CNY',
    '￥': 'CNY',
    RMB: 'CNY',
    CNY: 'CNY',
    '€': 'EUR',
    EUR: 'EUR',
    '£': 'GBP',
    GBP: 'GBP',
    '₩': 'KRW',
    KRW: 'KRW',
    'HK$': 'HKD',
    HKD: 'HKD',
    'A$': 'AUD',
    'C$': 'CAD',
  }
  return map[unit.trim()] || unit.trim()
}

/** USD 兜底汇率（2026-09 初值）。仅当缓存与在线拉取都失败时使用，误差可接受。 */
const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  CNY: 6.71,
  EUR: 0.86,
  GBP: 0.74,
  JPY: 154.8,
  KRW: 1348,
  HKD: 7.84,
  AUD: 1.52,
  CAD: 1.38,
  TWD: 32.3,
  SGD: 1.29,
  INR: 88.5,
  RUB: 82,
}

interface FxCache {
  date: string
  rates: Record<string, number> // USD → X
  fetchedAt: number
}

function readCache(): FxCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as FxCache
    if (!c.rates?.USD) return null
    return c
  } catch {
    return null
  }
}

function writeCache(cache: FxCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* 存储满/隐私模式：汇率降级为兜底值，不影响页面 */
  }
}

/** 拉取最新汇率；任何失败返回 null（调用方回退缓存/兜底值）。 */
async function fetchLatest(): Promise<FxCache | null> {
  try {
    const res = await fetch(API)
    if (!res.ok) return null
    const json = (await res.json()) as { date?: string; rates?: Record<string, number> }
    if (!json.rates) return null
    return {
      date: json.date || new Date().toISOString().slice(0, 10),
      rates: { USD: 1, ...json.rates },
      fetchedAt: Date.now(),
    }
  } catch {
    return null
  }
}

/**
 * 获取 USD→X 汇率表。
 * 顺序：fresh 缓存（<24h）→ 在线拉取 → 过期缓存 → 内置兜底。
 * 异步只发生在缓存过期时；命中 fresh 缓存是同步语义包裹的 Promise。
 */
export async function getUsdRates(): Promise<{ rates: Record<string, number>; source: string; date: string }> {
  const cached = readCache()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { rates: cached.rates, source: '缓存', date: cached.date }
  }
  const fresh = await fetchLatest()
  if (fresh) {
    writeCache(fresh)
    return { rates: fresh.rates, source: 'Frankfurter', date: fresh.date }
  }
  if (cached) {
    return { rates: cached.rates, source: '过期缓存', date: cached.date }
  }
  return { rates: FALLBACK_USD_RATES, source: '内置兜底', date: '—' }
}

/** 金额从币种 from 折算到 to。汇率表是 USD 基准的交叉汇率。 */
export function convert(amount: number, from: string, to: string, usdRates: Record<string, number>): number {
  if (from === to) return amount
  const f = usdRates[from]
  const t = usdRates[to]
  if (!f || !t) return amount // 未知币种不折算，保留原值
  return (amount / f) * t
}
