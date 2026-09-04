import { ArrowDown, ArrowUp, Clock } from 'lucide-react'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { DistroLogo } from './DistroLogo'
import { bytes, pct, uptime } from '../utils/format'
import { daysUntilNextReset, nextCycleStartId } from '../utils/trafficCycle'
import { deriveUsage, displayName, osLabel, virtLabel } from '../utils/derive'
import { cn, loadColor } from '../utils/cn'
import type { LatencyTracks, TrackBlock } from '../utils/latency'
import { UptimeBar } from './UptimeBar'
import type { Node } from '../types'
import { memo } from 'react'
import type { NodeStatusCategory, AbnormalCounters } from '../utils/stableStatus'
import { getStatusReasons } from '../utils/stableStatus'

export interface MiniCardProps {
  node: Node
  latencyTracks?: LatencyTracks
  status?: NodeStatusCategory
  counters?: AbnormalCounters
}

function miniCardEqual(prev: MiniCardProps, next: MiniCardProps) {
  if (prev.status !== next.status) return false
  if (prev.latencyTracks !== next.latencyTracks) return false
  if (prev.counters !== next.counters) return false
  const pn = prev.node, nn = next.node
  return pn.uuid === nn.uuid
    && pn.online === nn.online
    && pn.dynamic === nn.dynamic
    && pn.monthlyTraffic === nn.monthlyTraffic
    && pn.meta === nn.meta
}

export const MiniCard = memo<MiniCardProps>(function MiniCard({ node, latencyTracks, status, counters }: MiniCardProps) {
  const hostname = displayName(node)
  const osInfo = osLabel(node)
  const virtInfo = virtLabel(node)
  const flagCode = node.meta?.region
  const isOnline = node.online
  const tags = Array.isArray(node.meta?.tags) ? node.meta.tags : []

  const u = deriveUsage(node)
  const systemInfo = [osInfo, virtInfo].filter(Boolean).join(' · ')

  // 异常原因标签
  const reasonBadges = (status === 'warning' || status === 'risk')
    ? getStatusReasons(node, counters)
    : []

  // 月流量
  const monthlyTraffic = node.monthlyTraffic
  const trafficIn = monthlyTraffic?.received ?? 0
  const trafficOut = monthlyTraffic?.transmitted ?? 0
  const trafficResetDay = node.meta?.trafficResetDay ?? 1
  const trafficResetIn = monthlyTraffic ? daysUntilNextReset(trafficResetDay) : null

  // 联通 (CU) 时间序列色块数据
  const cuTrack = latencyTracks?.cu
  const cuBlocks = cuTrack?.blocks ?? []

  // 从所有 blocks 聚合计算平均延迟和丢包率（用于旁边的文字标注）
  const cuStats = (() => {
    const validBlocks = cuBlocks.filter(b => b.status !== 'empty')
    if (!validBlocks.length) return null
    let totalAvg = 0, avgCount = 0
    let totalLoss = 0, lossCount = 0
    for (const b of validBlocks) {
      if (b.avg != null && b.avg > 0) { totalAvg += b.avg; avgCount++ }
      if (b.total > 0) { totalLoss += b.lossCount / b.total; lossCount++ }
    }
    return {
      avgLatency: avgCount > 0 ? totalAvg / avgCount : null,
      lossRate: lossCount > 0 ? (totalLoss / lossCount) * 100 : 0,
    }
  })()

  const displayBlocks: (TrackBlock | null)[] = cuBlocks.length > 0
    ? cuBlocks
    : Array.from({ length: 24 }, () => null)

  return (
    <a href={`#${encodeURIComponent(node.uuid)}`} className="block">
      <Card
        className={cn(
          'p-3 transition hover:border-primary/50 hover:shadow-md flex flex-col gap-2',
          !isOnline && 'opacity-60',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot online={isOnline} status={status} />
          <DistroLogo node={node} className="w-4 h-4 shrink-0 object-contain" />
          <span className="font-semibold text-sm flex-1 min-w-0 truncate" title={hostname}>
            {hostname}
          </span>
          {reasonBadges.length > 0 && (
            <div className="flex gap-0.5 shrink-0">
              {reasonBadges.slice(0, 2).map(r => {
                const color = status === 'risk'
                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25'
                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25'
                return (
                  <Badge key={r.key} variant="outline" className={cn('text-[9px] font-medium px-1 py-0 leading-tight', color)}>
                    {r.display}
                  </Badge>
                )
              })}
            </div>
          )}
          <Flag code={flagCode} className="shrink-0" />
        </div>

        {/* System Info */}
        {systemInfo && (
          <div className="font-mono text-[10px] text-muted-foreground truncate leading-tight" title={systemInfo}>
            {systemInfo}
          </div>
        )}

        {/* Compact Resource Metrics */}
        <div className="flex flex-col gap-1.5">
          <CompactMetric label="CPU" value={u.cpu} />
          <CompactMetric label="内存" value={u.mem} />
          <CompactMetric label="磁盘" value={u.disk} />

          {/* 月流量 — 单行 */}
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-muted-foreground w-7 shrink-0">流量</span>
            <span className="text-emerald-500 font-mono">↑{bytes(trafficOut)}</span>
            <span className="text-muted-foreground/40">|</span>
            <span className="text-blue-500 font-mono">↓{bytes(trafficIn)}</span>
            {trafficResetIn && (
              // 父级是 flex + gap-1，左侧间距已由 gap 提供，这里只补右侧，圆点两边才对称
              <span
                className="font-sans font-medium text-foreground/70 whitespace-nowrap"
                title={`${nextCycleStartId(trafficResetDay)} 00:00 重置`}
              >
                <span className="mr-1 text-foreground/40">·</span>
                {trafficResetIn}
              </span>
            )}
          </div>
        </div>

        {/* Network Quality - CU · Uptime Robot 风格 */}
        <div className="flex flex-col gap-1.5 pt-1 border-t border-dashed border-border/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground leading-none">网络质量 (CU · 24h)</span>
          </div>
          <div className="flex flex-col gap-[6px]">
            {/* 延迟条 */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground w-5 shrink-0 leading-none">延迟</span>
              <div className="flex-1 min-w-0">
                <UptimeBar blocks={displayBlocks} ispLabel="联通" barHeight={8} mode="latency" />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground w-12 text-right shrink-0 leading-none">
                {cuStats?.avgLatency != null ? `${cuStats.avgLatency.toFixed(0)}ms` : '—'}
              </span>
            </div>
            {/* 丢包条 */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground w-5 shrink-0 leading-none">丢包</span>
              <div className="flex-1 min-w-0">
                <UptimeBar blocks={displayBlocks} ispLabel="联通" barHeight={8} mode="loss" />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground w-12 text-right shrink-0 leading-none">
                {cuStats != null ? `${cuStats.lossRate.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Stats — single line */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground leading-none pt-1 border-t border-dashed border-border/50">
          <span className="inline-flex items-center gap-0.5 text-blue-500 shrink-0 whitespace-nowrap">
            <ArrowDown className="h-2.5 w-2.5 shrink-0" />{bytes(u.netIn || 0)}/s
          </span>
          <span className="inline-flex items-center gap-0.5 text-emerald-500 shrink-0 whitespace-nowrap">
            <ArrowUp className="h-2.5 w-2.5 shrink-0" />{bytes(u.netOut || 0)}/s
          </span>
          <span className="inline-flex items-center gap-0.5 ml-auto shrink-0 whitespace-nowrap">
            <Clock className="h-2.5 w-2.5 shrink-0" />{uptime(u.uptime)}
          </span>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(t => (
              <Badge key={t} variant="outline" className="text-[9px] px-1 py-0">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </a>
  )
}, miniCardEqual)


// --- Compact metric row: label + percentage + progress bar ---
function CompactMetric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground w-7 shrink-0">{label}</span>
      <span className="text-[11px] font-mono tabular-nums w-10 text-right shrink-0">{pct(value)}</span>
      <Progress
        value={value}
        indicatorClassName={loadColor(value)}
        className="flex-1 h-1"
      />
    </div>
  )
}
