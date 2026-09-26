import { memo, useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Progress } from './ui/progress'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { DistroLogo } from './DistroLogo'
import { NodeDrawer } from './NodeDrawer'
import { bytes, pct } from '../utils/format'
import { cpuLabel, deriveUsage, displayName } from '../utils/derive'
import { avgLatency } from '../utils/latency'
import type { LatencyTracks } from '../utils/latency'
import { hasCost, remainingDays } from '../utils/cost'
import { daysUntilNextReset, nextCycleStartId } from '../utils/trafficCycle'
import { cn, loadColor } from '../utils/cn'
import { getStatusReasons } from '../utils/stableStatus'
import type { AbnormalCounters, NodeStatusCategory } from '../utils/stableStatus'
import { nextSort, pinAbnormal } from '../utils/tableSort'
import type { Node, Sort, SortDir } from '../types'

export interface NodeTableProps {
  nodes: Node[]
  latencyTracks: Map<string, LatencyTracks>
  statuses: Map<string, NodeStatusCategory>
  counters: Map<string, AbnormalCounters>
  sort: Sort
  sortDir: SortDir
  onSort: (sort: Sort, dir: SortDir) => void
  /** 抽屉里「查看完整详情」：切到整页 NodeDetail */
  onOpen: (uuid: string) => void
  showSource: boolean
}

interface Column {
  key: Sort
  label: string
  /** 表头与单元格共用：宽度、对齐 */
  className?: string
}

/*
 * 表头即排序：点一列按它排，再点一次反向，和导航栏排序菜单是同一份状态。
 * 状态不单列——点画在名称前面；异常优先在菜单里，且注意/风险行本来就置顶。
 * 列宽按 xl 视口（侧栏之外约 870px）压过，再宽就撑不下，只能横向滚。
 */
const COLUMNS: Column[] = [
  { key: 'name', label: '名称', className: 'min-w-[180px]' },
  { key: 'region', label: '地区', className: 'w-14' },
  { key: 'cpu', label: 'CPU', className: 'w-[88px]' },
  { key: 'mem', label: '内存', className: 'w-[88px]' },
  { key: 'disk', label: '磁盘', className: 'w-[88px]' },
  { key: 'trafficPct', label: '周期流量', className: 'w-[140px]' },
  { key: 'latency', label: '延迟 24h', className: 'w-[72px] text-right' },
  { key: 'netIn', label: '带宽', className: 'w-[92px] text-right' },
  { key: 'expire', label: '到期', className: 'w-[60px] text-right' },
]

// 表头在 xl 起钉在导航栏下面。更窄时表格横向滚动，sticky 只对滚动容器生效，钉不到视口上
const TH =
  'h-9 px-3 text-left align-middle text-[11px] font-medium text-muted-foreground whitespace-nowrap bg-card border-b border-border xl:sticky xl:top-[60px] xl:z-[2] first:rounded-tl-2xl last:rounded-tr-2xl'
const TD = 'px-3 py-2 align-middle border-b border-border/60'
// 横向滚动时名称列钉在左边，不然滚到右边就不知道看的是哪台
const STICKY = 'max-xl:sticky max-xl:left-0 max-xl:z-[1] max-xl:bg-card'

/** 数值配色与进度条同阈值：颜色永远和数字一起出现，色觉障碍下也能读 */
function valueColor(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return 'text-muted-foreground'
  if (v >= 90) return 'text-rose-500'
  if (v >= 70) return 'text-amber-500'
  return ''
}

function Usage({ value, title }: { value?: number; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className={cn('text-xs tabular-nums', valueColor(value))}>{pct(value)}</div>
      <Progress value={value} indicatorClassName={loadColor(value)} className="mt-1 h-1" />
    </div>
  )
}

interface RowProps {
  node: Node
  latencyTracks?: LatencyTracks
  status?: NodeStatusCategory
  counters?: AbnormalCounters
  selected: boolean
  showSource: boolean
  onSelect: (uuid: string) => void
}

function rowEqual(p: RowProps, n: RowProps) {
  if (p.status !== n.status || p.latencyTracks !== n.latencyTracks || p.counters !== n.counters) return false
  if (p.selected !== n.selected || p.showSource !== n.showSource || p.onSelect !== n.onSelect) return false
  const a = p.node, b = n.node
  return a.uuid === b.uuid
    && a.online === b.online
    && a.dynamic === b.dynamic
    && a.monthlyTraffic === b.monthlyTraffic
    && a.meta === b.meta
}

const Row = memo<RowProps>(function Row({ node, latencyTracks, status, counters, selected, showSource, onSelect }) {
  const u = deriveUsage(node)
  const latency = avgLatency(latencyTracks)
  const reasons = status === 'warning' || status === 'risk' ? getStatusReasons(node, counters) : []
  const region = node.meta?.region?.trim().toUpperCase()

  const mt = node.monthlyTraffic
  const isMaxBilling = node.meta?.trafficBillingMode === 'max'
  const resetDay = node.meta?.trafficResetDay ?? 1
  const resetIn = mt ? daysUntilNextReset(resetDay) : null
  // X/limit 与进度条同口径：单向计费时取上/下行较大者
  const trafficText = mt
    ? mt.limit
      ? `${bytes(isMaxBilling ? mt.billed ?? mt.total : mt.total)} / ${bytes(mt.limit)}`
      : bytes(mt.total)
    : null
  const trafficTitle = mt
    ? [
        isMaxBilling ? `单向计费：取上/下行较大者，双向累计 ${bytes(mt.total)}` : null,
        `↓ ${bytes(mt.received)} · ↑ ${bytes(mt.transmitted)}`,
        `周期: ${nextCycleStartId(resetDay)} 00:00 重置`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '等待定时采样'

  const days = hasCost(node.meta) ? remainingDays(node.meta.expireTime) : null

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(node.uuid)
    }
  }

  return (
    <tr
      tabIndex={0}
      data-state={selected ? 'selected' : undefined}
      onClick={() => onSelect(node.uuid)}
      onKeyDown={onKey}
      className={cn(
        'cursor-pointer outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 data-[state=selected]:bg-muted',
        !node.online && 'opacity-60',
      )}
    >
      <td className={cn(TD, COLUMNS[0].className, STICKY)}>
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot online={node.online} status={status} />
          <DistroLogo node={node} className="w-4 h-4 shrink-0 object-contain" />
          <span className="truncate text-[13px] font-medium" title={displayName(node)}>
            {displayName(node)}
          </span>
          {reasons.length > 0 && (
            <span className={cn('shrink-0 text-[10px] font-medium', status === 'risk' ? 'text-rose-500' : 'text-amber-500')}>
              {reasons.map(r => r.display).join(' · ')}
            </span>
          )}
          {showSource && node.source && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{node.source}</span>
          )}
        </div>
      </td>
      <td className={cn(TD, COLUMNS[1].className)}>
        {region ? (
          <span className="inline-flex items-center gap-1.5">
            <Flag code={region} />
            <span className="font-mono text-[11px] text-muted-foreground">{region}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className={cn(TD, COLUMNS[2].className)}>
        <Usage value={u.cpu} title={cpuLabel(node) || undefined} />
      </td>
      <td className={cn(TD, COLUMNS[3].className)}>
        <Usage value={u.mem} title={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : undefined} />
      </td>
      <td className={cn(TD, COLUMNS[4].className)}>
        <Usage value={u.disk} title={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : undefined} />
      </td>
      <td className={cn(TD, COLUMNS[5].className)}>
        <div className="min-w-0" title={trafficTitle}>
          <div className={cn('text-[11px] tabular-nums whitespace-nowrap', valueColor(mt?.percent))}>
            {trafficText ?? <span className="text-muted-foreground">—</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Progress value={mt?.percent} indicatorClassName={loadColor(mt?.percent)} className="h-1 flex-1" />
            {resetIn && <span className="shrink-0 text-[10px] leading-none text-muted-foreground">{resetIn}</span>}
          </div>
        </div>
      </td>
      <td className={cn(TD, COLUMNS[6].className, 'font-mono text-xs tabular-nums')}>
        {!node.online ? (
          <span className="text-rose-500">离线</span>
        ) : latency != null ? (
          `${latency.toFixed(0)} ms`
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className={cn(TD, COLUMNS[7].className, 'font-mono text-[11px] tabular-nums leading-snug whitespace-nowrap')}>
        <div className="text-blue-500">↓ {bytes(u.netIn || 0)}/s</div>
        <div className="text-emerald-500">↑ {bytes(u.netOut || 0)}/s</div>
      </td>
      <td className={cn(TD, COLUMNS[8].className, 'text-xs tabular-nums whitespace-nowrap')}>
        {days == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            title={node.meta?.expireTime}
            className={cn(days <= 7 ? 'text-rose-500' : days <= 30 ? 'text-amber-500' : undefined)}
          >
            {days < 0 ? '已过期' : `${days} 天`}
          </span>
        )}
      </td>
    </tr>
  )
}, rowEqual)

/**
 * 表格视图：一屏看全所有机器，按列排序，异常置顶；点一行拉出抽屉看这台的仪表盘。
 * 卡片是浏览，分析是总账，这里负责挑毛病。
 */
export function NodeTable({
  nodes,
  latencyTracks,
  statuses,
  counters,
  sort,
  sortDir,
  onSort,
  onOpen,
  showSource,
}: NodeTableProps) {
  const [inspect, setInspect] = useState<string | null>(null)
  const inspected = inspect ? nodes.find(n => n.uuid === inspect) ?? null : null
  // 被筛掉的机器不该还挂着抽屉
  useEffect(() => {
    if (inspect && !inspected) setInspect(null)
  }, [inspect, inspected])
  const closeDrawer = useCallback(() => setInspect(null), [])

  const { pinned, rest } = pinAbnormal(nodes, n => statuses.get(n.uuid))
  const DirIcon = sortDir === 'asc' ? ArrowUp : ArrowDown

  const renderRow = (n: Node) => (
    <Row
      key={n.uuid}
      node={n}
      latencyTracks={latencyTracks.get(n.uuid)}
      status={statuses.get(n.uuid)}
      counters={counters.get(n.uuid)}
      selected={n.uuid === inspect}
      showSource={showSource}
      onSelect={setInspect}
    />
  )

  return (
    <>
      <div className="rounded-2xl border bg-card text-card-foreground card-flat hover:translate-y-0">
        <div className="rounded-2xl overflow-x-auto xl:overflow-visible">
          {/* border-separate：collapse 模式下 sticky 单元格的边框不跟着走，会留下一条错位的线 */}
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {COLUMNS.map((c, i) => {
                  const active = c.key === sort
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cn(TH, c.className, i === 0 && STICKY)}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(...nextSort(sort, sortDir, c.key))}
                        title={active ? '再点一次反向' : `按${c.label}排序`}
                        className={cn(
                          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                          active && 'text-foreground font-semibold',
                        )}
                      >
                        {c.label}
                        {active && <DirIcon className="h-3 w-3" />}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-0">
              {pinned.map(renderRow)}
              {pinned.length > 0 && rest.length > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={COLUMNS.length} className="h-[3px] p-0 bg-amber-500/30" />
                </tr>
              )}
              {rest.map(renderRow)}
            </tbody>
          </table>
        </div>
      </div>

      {inspected && (
        <NodeDrawer
          key={inspected.uuid}
          node={inspected}
          latencyTracks={latencyTracks.get(inspected.uuid)}
          status={statuses.get(inspected.uuid)}
          counters={counters.get(inspected.uuid)}
          showSource={showSource}
          onClose={closeDrawer}
          onOpenFull={() => onOpen(inspected.uuid)}
        />
      )}
    </>
  )
}
