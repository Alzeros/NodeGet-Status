import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeftRight, Coins, ShieldAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { bytes } from '../utils/format'
import { deriveUsage, displayName } from '../utils/derive'
import { remainingDays } from '../utils/cost'
import { cn, loadColor } from '../utils/cn'
import { Flag } from './Flag'
import { currencyCode, convert, getUsdRates } from '../utils/currency'
import type { Node } from '../types'
import type { NodeStatusCategory } from '../utils/stableStatus'

/*
 * 数据分析视图：纯前端聚合，数据源与其它视图同源（App 传入的 nodes）。
 * 视觉上走"排行榜 + 内嵌进度条"的密集列表，而不是稀疏的大画布柱状图——
 * 探针页一屏几十台机器，榜单比图表的信息密度高得多。
 * 榜单取 Top 10；分析页是"看大盘"的入口，逐台排查留给卡片视图的排序。
 */

const TOP_N = 10

interface Props {
  nodes: Node[]
  statuses: Map<string, NodeStatusCategory>
  showSource: boolean
}

type Metric = 'cpu' | 'mem' | 'disk' | 'bandwidth'

const METRICS: { key: Metric; label: string }[] = [
  { key: 'cpu', label: 'CPU' },
  { key: 'mem', label: '内存' },
  { key: 'disk', label: '磁盘' },
  { key: 'bandwidth', label: '带宽' },
]

function Card({
  title,
  subtitle,
  children,
  className,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl p-4 sm:p-5 bg-card text-card-foreground card-soft hover:translate-y-0 flex flex-col',
        className,
      )}
    >
      <div className="flex items-baseline justify-between mb-3.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

/** 图表里每行的名字：多主控时带来源前缀，单主控保持干净 */
function nodeLabel(n: Node, showSource: boolean) {
  const name = displayName(n)
  return showSource ? `${n.source}·${name}` : name
}

/** 地区代码：规整成两位大写字母，无效值返回 null（Flag 组件自身也会兜底） */
function regionOf(n: Node) {
  const code = n.meta?.region?.trim().toUpperCase()
  return code && /^[A-Z]{2}$/.test(code) ? code : null
}

/** 带宽值：上下行合计（与 GlobalStats 的 totalBandwidth 同口径） */
function bandwidthOf(n: Node) {
  const u = deriveUsage(n)
  return (u.netIn ?? 0) + (u.netOut ?? 0)
}

/**
 * 价格榜行数据。所有金额已折算到主币种（targetCurrency）的**月均**口径
 * （日成本 × 30），跨机器可比——不受各节点计费周期长短影响。
 * originalCost/originalUnit 保留原币种的月均值供 tooltip 展示。
 */
interface PriceRow {
  name: string
  region: string | null    // 两位地区码，名称旁的国旗用
  monthlyCost: number      // 月均花费（主币种，已折算）
  originalMonthly: number  // 原币种的月均花费
  originalUnit: string     // 原币种符号
  originalCycle: number    // 原计费周期（天），tooltip 展示"¥xx/90天"用
  originalPrice: number    // 原币种的整期价格
  remaining: number | null // 流量剩余额度（%），无 limit 时 null
}

function buildPriceData(
  visible: Node[],
  showSource: boolean,
  usdRates: Record<string, number>,
  target: string, // ISO 代码，折算目标
): PriceRow[] {
  const rows: PriceRow[] = []
  for (const n of visible) {
    const meta = n.meta
    if (!meta || meta.price <= 0 || !meta.priceCycle) continue
    const unit = meta.priceUnit || '$'
    const code = currencyCode(unit)
    const monthlyOriginal = (meta.price / meta.priceCycle) * 30
    const billed = n.monthlyTraffic?.billed ?? 0
    const limit = n.monthlyTraffic?.limit
    const usedPct = limit && limit > 0 ? (billed / limit) * 100 : null
    rows.push({
      name: nodeLabel(n, showSource),
      region: regionOf(n),
      monthlyCost: convert(monthlyOriginal, code, target, usdRates),
      originalMonthly: monthlyOriginal,
      originalUnit: unit,
      originalCycle: meta.priceCycle,
      originalPrice: meta.price,
      remaining: usedPct != null ? Math.max(0, 100 - usedPct) : null,
    })
  }
  // 按月均花费降序：钱花在哪一目了然
  rows.sort((a, b) => b.monthlyCost - a.monthlyCost)
  return rows
}

/** 排名徽章：前三名高亮，其余弱化 */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'shrink-0 w-5 h-5 rounded-md text-[10px] font-bold tabular-nums flex items-center justify-center',
        rank <= 3 ? 'bg-primary/10 text-primary' : 'bg-secondary/60 text-muted-foreground/70',
      )}
    >
      {rank}
    </span>
  )
}

/**
 * 排行榜行：排名 + 国旗 + 名称 + 内嵌进度条 + 右对齐数值。
 * barPct 传 0~100；barClass 决定进度条颜色（百分比指标用 loadColor，其余用主题色）。
 */
function RankRow({
  rank,
  label,
  region,
  valueText,
  barPct,
  barClass,
  dim,
}: {
  rank: number
  label: string
  region?: string | null
  valueText: string
  barPct: number
  barClass: string
  dim?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-2.5 group', dim && 'opacity-45')}>
      <RankBadge rank={rank} />
      <span className="w-36 sm:w-44 shrink-0 flex items-center gap-1.5 text-xs" title={label}>
        {region && <Flag code={region} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-muted/80 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barClass)}
          style={{ width: `${Math.min(100, Math.max(barPct, barPct > 0 ? 2 : 0))}%` }}
        />
      </div>
      <span className="w-16 sm:w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {valueText}
      </span>
    </div>
  )
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
  valueClass,
}: {
  icon: LucideIcon
  label: string
  value: string
  sub?: string
  iconBg: string
  valueClass?: string
}) {
  return (
    <div className="rounded-2xl p-4 bg-card text-card-foreground card-soft hover:translate-y-0 flex items-center gap-3.5">
      <div className={cn('shrink-0 w-10 h-10 rounded-xl flex items-center justify-center', iconBg)}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={cn('text-xl font-bold tabular-nums leading-tight mt-0.5', valueClass)}>
          {value}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground/70 truncate mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

export function StatsView({ nodes, statuses, showSource }: Props) {
  const [metric, setMetric] = useState<Metric>('cpu')

  const visible = useMemo(() => nodes.filter(n => !n.meta?.hidden), [nodes])

  const kpi = useMemo(() => {
    let online = 0
    let totalIn = 0
    let totalOut = 0
    let trafficTotal = 0
    const statusCounts = { normal: 0, warning: 0, risk: 0, offline: 0 }
    const regions = new Map<string, { total: number; online: number }>()

    for (const n of visible) {
      const u = deriveUsage(n)
      if (n.online) {
        online++
        totalIn += u.netIn ?? 0
        totalOut += u.netOut ?? 0
      }
      trafficTotal += n.monthlyTraffic?.total ?? 0
      const cat = statuses.get(n.uuid) ?? 'normal'
      statusCounts[cat]++
      const code = n.meta?.region?.trim().toUpperCase() || '未知'
      const r = regions.get(code) || { total: 0, online: 0 }
      r.total++
      if (n.online) r.online++
      regions.set(code, r)
    }

    return {
      online,
      total: visible.length,
      totalIn,
      totalOut,
      trafficTotal,
      statusCounts,
      regions: [...regions.entries()]
        .map(([code, r]) => ({ code, ...r }))
        .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code)),
    }
  }, [visible, statuses])

  const metricData = useMemo(() => {
    const items = visible.map(n => {
      const u = deriveUsage(n)
      const value =
        metric === 'cpu'
          ? u.cpu
          : metric === 'mem'
            ? u.mem
            : metric === 'disk'
              ? u.disk
              : bandwidthOf(n)
      return {
        name: nodeLabel(n, showSource),
        region: regionOf(n),
        value: value != null && Number.isFinite(value) ? value : 0,
        online: n.online,
      }
    })
    // 非在线节点沉底：榜单应反映"当前谁在吃资源"
    items.sort((a, b) => b.value - a.value || (a.online === b.online ? 0 : a.online ? -1 : 1))
    return items.slice(0, TOP_N)
  }, [visible, metric, showSource])

  // 带宽榜的进度条按最大值归一；CPU/内存/磁盘天然是 0~100
  const metricMax = Math.max(...metricData.map(d => d.value), 1)

  const trafficData = useMemo(
    () =>
      visible
        .map(n => ({
          name: nodeLabel(n, showSource),
          region: regionOf(n),
          value: n.monthlyTraffic?.total ?? 0,
          received: n.monthlyTraffic?.received ?? 0,
          transmitted: n.monthlyTraffic?.transmitted ?? 0,
        }))
        .filter(d => d.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, TOP_N),
    [visible, showSource],
  )
  const trafficMax = Math.max(...trafficData.map(d => d.value), 1)

  // 价格榜：scaleDays 决定展示折算（本周期=整期价格，日均/周均按日成本折算）
  // 汇率：确定主币种（本周期花费占比最高的币种），拉取 USD 基准汇率做交叉折算
  const [fx, setFx] = useState<{ rates: Record<string, number>; source: string; date: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    getUsdRates().then(r => {
      if (!cancelled) setFx(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 主币种：按原币种的本周期花费占比最大者（不经汇率，避免先有鸡还是先有蛋）
  const targetCurrency = useMemo(() => {
    const byCurrency = new Map<string, number>()
    for (const n of visible) {
      const meta = n.meta
      if (!meta || meta.price <= 0 || !meta.priceCycle) continue
      const code = currencyCode(meta.priceUnit || '$')
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + meta.price)
    }
    let best = 'CNY'
    let bestTotal = -1
    for (const [code, total] of byCurrency) {
      if (total > bestTotal) {
        best = code
        bestTotal = total
      }
    }
    return best
  }, [visible])
  const targetSymbol = useMemo(() => {
    const map: Record<string, string> = {
      USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩', HKD: 'HK$', AUD: 'A$', CAD: 'C$', TWD: 'NT$', SGD: 'S$', INR: '₹',
    }
    return map[targetCurrency] || targetCurrency
  }, [targetCurrency])

  const priceData = useMemo(() => {
    if (!fx) return []
    return buildPriceData(visible, showSource, fx.rates, targetCurrency)
  }, [visible, showSource, fx, targetCurrency])
  // 月度总成本（主币种）+ 主币种符号；与榜单同口径（日成本×30）
  const monthlyCost = useMemo(() => {
    if (!fx) return { total: 0, count: 0 }
    let total = 0
    let count = 0
    for (const n of visible) {
      const meta = n.meta
      if (!meta || meta.price <= 0 || !meta.priceCycle) continue
      total += convert((meta.price / meta.priceCycle) * 30, currencyCode(meta.priceUnit || '$'), targetCurrency, fx.rates)
      count++
    }
    return { total, count }
  }, [visible, fx, targetCurrency])

  const expireBuckets = useMemo(() => {
    const buckets = [
      { label: '已过期', min: -Infinity, max: 0, count: 0, color: '#e06b63' },
      { label: '7天内', min: 1, max: 7, count: 0, color: '#dba54a' },
      { label: '8~30天', min: 8, max: 30, count: 0, color: '#1a72d1' },
      { label: '31~90天', min: 31, max: 90, count: 0, color: '#3ecc79' },
      { label: '90天以上', min: 91, max: Infinity, count: 0, color: '#8b5cf6' },
    ]
    let withExpire = 0
    const expiring30: { name: string; region: string | null; days: number }[] = []
    for (const n of visible) {
      const days = remainingDays(n.meta?.expireTime ?? '')
      if (days == null) continue
      withExpire++
      if (days <= 30) {
        expiring30.push({ name: nodeLabel(n, showSource), region: regionOf(n), days })
      }
      for (const b of buckets) {
        if (days >= b.min && days <= b.max) {
          b.count++
          break
        }
      }
    }
    // 剩余天数升序：最紧急的排最前
    expiring30.sort((a, b) => a.days - b.days)
    return { buckets: buckets.filter(b => b.count > 0), withExpire, expiring30 }
  }, [visible, showSource])

  const abnormalCount = kpi.statusCounts.warning + kpi.statusCounts.risk + kpi.statusCounts.offline

  if (visible.length === 0) {
    return <div className="py-24 text-center text-sm text-muted-foreground">暂无节点数据</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* KPI 行 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiTile
          icon={Activity}
          iconBg="bg-emerald-500/10 text-emerald-600"
          label="在线率"
          value={`${kpi.total ? Math.round((kpi.online / kpi.total) * 100) : 0}%`}
          sub={`${kpi.online} / ${kpi.total} 台在线`}
        />
        <KpiTile
          icon={ArrowLeftRight}
          iconBg="bg-blue-500/10 text-blue-600"
          label="实时带宽"
          value={bytes(kpi.totalIn + kpi.totalOut) + '/s'}
          sub={`↓${bytes(kpi.totalIn)} · ↑${bytes(kpi.totalOut)}`}
        />
        <KpiTile
          icon={Coins}
          iconBg="bg-amber-500/10 text-amber-600"
          label="月度成本"
          value={`${targetSymbol}${monthlyCost.total.toFixed(0)}`}
          sub={
            fx
              ? `${monthlyCost.count} 台计费 · 已按汇率折算（${fx.source} ${fx.date}）`
              : '正在获取汇率…'
          }
        />
        <KpiTile
          icon={ShieldAlert}
          iconBg={abnormalCount > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}
          label="异常节点"
          value={String(abnormalCount)}
          sub={`注意 ${kpi.statusCounts.warning} · 风险 ${kpi.statusCounts.risk} · 离线 ${kpi.statusCounts.offline}`}
          valueClass={abnormalCount > 0 ? 'text-amber-600' : 'text-emerald-600'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* 资源占用榜：CPU/内存/磁盘/带宽 四个维度切换 */}
        <Card title="资源占用排行" subtitle={`Top ${TOP_N} · 实时`} className="xl:col-span-3">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {METRICS.map(m => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full border border-transparent transition-all duration-200',
                  metric === m.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary/40 text-foreground/80 hover:bg-secondary/80',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {metricData.map((d, i) => {
              const isPct = metric !== 'bandwidth'
              return (
                <RankRow
                  key={d.name}
                  rank={i + 1}
                  label={d.name}
                  region={d.region}
                  dim={!d.online}
                  barPct={isPct ? d.value : (d.value / metricMax) * 100}
                  barClass={isPct ? loadColor(d.value) : 'bg-primary'}
                  valueText={isPct ? `${d.value.toFixed(1)}%` : bytes(d.value) + '/s'}
                />
              )
            })}
          </div>
          <div className="text-[10px] text-muted-foreground/70 mt-3">
            {metric === 'bandwidth'
              ? '按上下行速率之和排序，条长相对榜首归一'
              : '条色随负载变化：绿 <70% · 琥珀 70~90% · 红 ≥90%；非在线节点降透明度'}
          </div>
        </Card>

        {/* 成本榜：钱花在哪（月均，跨周期可比）+ 花得值不值（剩余量）。
            不画花费进度条：金额已降序排列，条长只是把右边的数字重复一遍，
            且 Top 10 金额接近时条长全挤在 85%~100%，零信息量。 */}
        <Card title="成本排行" subtitle="月均花费 · 按金额降序" className="xl:col-span-2">
          {priceData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-12">
              {fx ? '未配置价格的节点' : '正在获取汇率…'}
            </div>
          ) : (
            <>
              {/* 表头：列语义显式化。列全部左排紧凑布局，空白统一留行尾 */}
              <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground/70 mb-1.5">
                <span className="w-5 shrink-0" />
                <span className="w-36 sm:w-44 shrink-0">节点</span>
                <span className="shrink-0 w-12 text-right" title="本周期剩余流量 ÷ 额度">
                  流量剩余
                </span>
                <span className="shrink-0 w-16 sm:w-20 text-right">
                  月均（占总支出）
                </span>
              </div>
              <div className="flex flex-col gap-2 flex-1">
                {priceData.slice(0, TOP_N).map((d, i) => {
                  // 占比恒显示：省略规则（<1% 隐藏）曾导致同列忽有忽无
                  const share = monthlyCost.total > 0 ? (d.monthlyCost / monthlyCost.total) * 100 : 0
                  const r = d.remaining
                  return (
                    <div key={d.name} className="flex items-center gap-2.5">
                      <RankBadge rank={i + 1} />
                      <span className="w-36 sm:w-44 shrink-0 flex items-center gap-1.5 text-xs" title={d.name}>
                        {d.region && <Flag code={d.region} className="shrink-0" />}
                        <span className="truncate">{d.name}</span>
                      </span>
                      <span className="shrink-0 w-12 flex justify-end">
                        {/* 剩余徽章：剩得少才是要警惕的（快超量/可能被刷），绿=余量充足是常态 */}
                        {r != null ? (
                          <span
                            className={cn(
                              'inline-block px-1.5 py-0.5 rounded text-[10px] tabular-nums font-semibold leading-none',
                              r <= 10
                                ? 'bg-rose-500/10 text-rose-600'
                                : r <= 30
                                  ? 'bg-amber-500/10 text-amber-600'
                                  : 'bg-emerald-500/10 text-emerald-600',
                            )}
                            title={`本周期流量剩余 ${r.toFixed(1)}%（≤10% 即将耗尽 · 10~30% 偏低 · >30% 充足）`}
                          >
                            {r.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[11px] tabular-nums text-muted-foreground/50" title="未设置流量额度">
                            —
                          </span>
                        )}
                      </span>
                      <span
                        className="shrink-0 text-xs tabular-nums font-semibold w-16 sm:w-20 text-right"
                        title={
                          currencyCode(d.originalUnit) === targetCurrency
                            ? `${d.originalUnit}${d.originalPrice.toFixed(2)} / ${d.originalCycle}天`
                            : `${d.originalUnit}${d.originalPrice.toFixed(2)} / ${d.originalCycle}天，按 ${fx?.source ?? ''} ${fx?.date ?? ''} 汇率折算`
                        }
                      >
                        {targetSymbol}
                        {d.monthlyCost >= 100 ? d.monthlyCost.toFixed(0) : d.monthlyCost.toFixed(2)}
                        <span className="text-muted-foreground/60 ml-1 text-[10px]">
                          ·{share.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          <div className="text-[10px] text-muted-foreground/70 mt-3">
            流量剩余 = 额度 − 本周期已用；月均 = 整期价格按周期天数折算，已统一换算为{targetSymbol}
            {fx && `（${fx.source} ${fx.date}）`}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* 周期流量榜 */}
        <Card title="周期流量排行" subtitle={`Top ${TOP_N} · 按计费周期累计`} className="xl:col-span-3">
          {trafficData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-12">
              暂无流量数据
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {trafficData.map((d, i) => (
                <RankRow
                  key={d.name}
                  rank={i + 1}
                  label={d.name}
                  region={d.region}
                  barPct={(d.value / trafficMax) * 100}
                  barClass="bg-amber-500"
                  valueText={bytes(d.value)}
                />
              ))}
            </div>
          )}
          {trafficData.length > 0 && (
            <div className="text-[10px] text-muted-foreground/70 mt-3">
              条长相对榜首归一
            </div>
          )}
        </Card>

        {/* 到期分布：堆叠条 + 图例 + 状态汇总 */}
        <Card title="到期与状态" subtitle={expireBuckets.withExpire === 0 ? '未设置到期时间' : '按剩余天数分桶'} className="xl:col-span-2">
          {expireBuckets.withExpire === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground py-12">
              节点均未设置到期时间
            </div>
          ) : (
            <div>
              {/* 堆叠条：一段一桶，宽度按占比 */}
              <div className="flex h-3 rounded-full overflow-hidden bg-muted/80">
                {expireBuckets.buckets.map(b => (
                  <div
                    key={b.label}
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${(b.count / expireBuckets.withExpire) * 100}%`,
                      backgroundColor: b.color,
                    }}
                    title={`${b.label} ${b.count} 台`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4">
                {expireBuckets.buckets.map(b => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="text-xs text-muted-foreground flex-1">{b.label}</span>
                    <span className="text-xs font-bold tabular-nums">{b.count}</span>
                  </div>
                ))}
              </div>
              {/* 30 天内到期明细：最紧急的在前，含已过期 */}
              {expireBuckets.expiring30.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border/40">
                  <div className="text-[11px] text-muted-foreground font-medium mb-2">
                    30 天内到期 · {expireBuckets.expiring30.length} 台
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto sidebar-scroll">
                    {expireBuckets.expiring30.map(e => (
                      <div key={e.name} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 min-w-0 flex items-center gap-1.5" title={e.name}>
                          {e.region && <Flag code={e.region} className="shrink-0" />}
                          <span className="truncate">{e.name}</span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 tabular-nums font-medium',
                            e.days <= 0 ? 'text-rose-600' : e.days <= 7 ? 'text-amber-600' : 'text-muted-foreground',
                          )}
                        >
                          {e.days <= 0 ? '已过期' : `${e.days} 天`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mt-auto pt-4 border-t border-border/40 grid grid-cols-4 gap-2">
            {([
              { label: '正常', count: kpi.statusCounts.normal, cls: 'text-emerald-600' },
              { label: '注意', count: kpi.statusCounts.warning, cls: 'text-amber-600' },
              { label: '风险', count: kpi.statusCounts.risk, cls: 'text-rose-600' },
              { label: '离线', count: kpi.statusCounts.offline, cls: 'text-muted-foreground' },
            ]).map(s => (
              <div key={s.label} className="text-center">
                <div className={cn('text-lg font-bold tabular-nums', s.cls)}>{s.count}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
