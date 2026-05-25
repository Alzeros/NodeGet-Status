import { ArrowDown, ArrowUp, Clock, Info, type LucideIcon } from 'lucide-react'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { cpuLabel, deriveUsage, displayName, distroLogo, osLabel, virtLabel } from '../utils/derive'
import { cn, loadColor } from '../utils/cn'
import type { LatencyTracks, IspKey } from '../utils/latency'
import type { Node } from '../types'
import type { ReactNode } from 'react'

export interface NodeCardProps {
  node: Node
  latencyTracks?: LatencyTracks
}

export function NodeCard({ node, latencyTracks }: NodeCardProps) {
  // --- 动态变量占位符 ---
  const hostname = displayName(node)
  const osInfo = osLabel(node)
  const virtInfo = virtLabel(node)
  const flagCode = node.meta?.region
  const logoUrl = distroLogo(node)
  const isOnline = node.online
  const tags = Array.isArray(node.meta?.tags) ? node.meta.tags : []

  // --- 使用率数据 ---
  const u = deriveUsage(node)
  const cpuInfo = cpuLabel(node)

  // --- 系统信息行 ---
  const systemInfo = [osInfo, virtInfo].filter(Boolean).join(' · ')

  // --- 网络质量行 ---
  const hasNetworkQuality = latencyTracks && (latencyTracks.cm || latencyTracks.cu || latencyTracks.ct)

  // --- 指标模板配置 (动态渲染) ---
  const monthlyTraffic = node.monthlyTraffic
  const trafficIn = monthlyTraffic?.received ?? 0
  const trafficOut = monthlyTraffic?.transmitted ?? 0
  const totalTraffic = trafficIn + trafficOut
  const trafficLimit = monthlyTraffic?.limit
  const trafficPercent = monthlyTraffic?.percent
  const trafficDetail = trafficLimit
    ? `${bytes(totalTraffic)} / ${bytes(trafficLimit)}`
    : monthlyTraffic
      ? `本月: ${bytes(totalTraffic)}`
      : '等待定时采样'

  const resourceMetrics: ResourceMetricItem[] = [
    {
      id: 'cpu',
      label: 'CPU',
      value: u.cpu,
      detail: cpuInfo || null,
      detailTitle: cpuInfo || undefined,
    },
    {
      id: 'mem',
      label: '内存',
      value: u.mem,
      detail: u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : null,
    },
    {
      id: 'disk',
      label: '磁盘',
      value: u.disk,
      detail: u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : null,
    },
    {
      id: 'traffic',
      label: '本月流量',
      valueNode: (
        <span title={trafficDetail}>
          <span className="text-emerald-500">↑ {bytes(trafficOut)}</span>
          <span className="text-muted-foreground mx-1">|</span>
          <span className="text-blue-500">↓ {bytes(trafficIn)}</span>
        </span>
      ),
      percent: trafficPercent,
      barClassName: loadColor(trafficPercent),
      detail: totalTraffic > 0 || trafficLimit || !monthlyTraffic ? trafficDetail : null,
      detailTitle: trafficLimit ? `本月流量上限: ${bytes(trafficLimit)}` : undefined,
    },

  ]

  return (
    <a href={`#${encodeURIComponent(node.uuid)}`} className="block">
      <Card
        className={cn(
          'p-4 transition hover:border-primary/50 hover:shadow-md flex flex-col gap-3',
          !isOnline && 'opacity-60',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <StatusDot online={isOnline} />
          {logoUrl && (
            <img src={logoUrl} alt="" className="w-5 h-5 shrink-0 object-contain" loading="lazy" />
          )}
          <span className="font-semibold flex-1 min-w-0 truncate" title={hostname}>
            {hostname}
          </span>
          <Flag code={flagCode} className="shrink-0" />
        </div>

        {/* System Info */}
        {systemInfo && (
          <div className="font-mono text-xs text-muted-foreground truncate" title={systemInfo}>
            {systemInfo}
          </div>
        )}

        {/* Resource Metrics */}
        <div className="flex flex-col gap-2.5">
          {resourceMetrics.map(m => (
            <ResourceRow
              key={m.id}
              label={m.label}
              valueNode={m.valueNode ?? <span className="tabular-nums">{pct(m.value)}</span>}
              percent={m.percent ?? m.value}
              barClassName={m.barClassName ?? loadColor(m.value)}
              barHeight={m.barHeight}
              detail={m.detail}
              detailTitle={m.detailTitle}
              align={m.align}
            />
          ))}
          {/* 网络质量区域 — 始终渲染以保持卡片底部对齐 */}
          <div className="flex flex-col gap-[4px]">
            <span className="text-xs text-muted-foreground">网络质量 (30min)</span>
            {hasNetworkQuality ? (
              <div className="flex flex-col gap-[4px] w-full">
                {(['cm', 'cu', 'ct'] as IspKey[]).map(ispKey => {
                  const track = latencyTracks?.[ispKey]
                  const emptyBlocks = Array.from({ length: 10 }, () => null)
                  return (
                    <div key={ispKey} className="flex items-center gap-[6px]">
                      <span className="text-[10px] font-semibold text-muted-foreground w-7 shrink-0 text-center leading-none">
                        {track?.shortLabel ?? ispKey.toUpperCase()}
                      </span>
                      <div
                        className="grid flex-1"
                        style={{ gridTemplateColumns: 'repeat(10, 1fr)', gap: '2px' }}
                      >
                        {(track?.blocks ?? emptyBlocks).map((b, i) => (
                          <div
                            key={i}
                            className="group relative z-0 h-[24px] flex items-center justify-center cursor-pointer hover:z-10"
                            title={
                              b
                                ? `${track!.label} | ${new Date(b.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(b.t + 180000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
延迟: ${b.avg?.toFixed(1) ?? '—'}ms | 丢包: ${b.lossCount}/${b.total}`
                                : '无数据'
                            }
                          >
                            <div
                              className={cn(
                                'relative w-full h-[10px] rounded-[2px] transition-all duration-150 group-hover:scale-125',
                                b ? b.className : 'bg-muted-foreground/5',
                              )}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="h-[80px] flex items-center justify-center gap-1.5 text-muted-foreground/40">
                <Info className="h-3.5 w-3.5" />
                <span className="text-xs">此服务器未开启ICMP ping监控</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Stats */}
        <div className="pt-2.5 border-t border-dashed font-mono text-xs text-muted-foreground space-y-1.5">
          <div className="flex items-center gap-3">
            <Stat icon={ArrowDown}>{bytes(u.netIn || 0)}/s</Stat>
            <Stat icon={ArrowUp}>{bytes(u.netOut || 0)}/s</Stat>
          </div>
          <div className="flex items-center gap-3">
            <Stat icon={Clock}>{uptime(u.uptime)}</Stat>
            <span className="ml-auto tabular-nums">{relativeAge(u.ts)}</span>
          </div>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map(t => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </a>
  )
}

// --- Sub Components ---

function Stat({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  )
}

interface ResourceMetricItem {
  id: string
  label: string
  value?: number
  valueNode?: ReactNode
  percent?: number
  barClassName?: string
  barHeight?: string
  detail?: string | null
  detailTitle?: string
  align?: 'baseline' | 'start' | 'center'
}

function ResourceRow({
  label,
  valueNode,
  percent,
  barClassName,
  detail,
  detailTitle,
  barHeight = 'h-1.5',
  align = 'baseline',
}: {
  label: string
  valueNode?: ReactNode
  percent?: number
  barClassName?: string
  detail?: string | null
  detailTitle?: string
  barHeight?: string
  align?: 'baseline' | 'start' | 'center'
}) {
  const alignClass =
    align === 'start' ? 'items-start' : align === 'center' ? 'items-center' : 'items-baseline'
  return (
    <div className="min-w-0">
      <div className={cn('flex justify-between text-xs gap-2', alignClass)}>
        <span className="text-muted-foreground shrink-0 whitespace-nowrap">{label}</span>
        <span className="text-right whitespace-nowrap overflow-hidden text-ellipsis">
          {valueNode}
        </span>
      </div>
      {percent != null && (
        <Progress
          value={percent}
          indicatorClassName={barClassName || 'bg-muted-foreground/40'}
          className={cn('mt-1 w-full', barHeight)}
        />
      )}
      {detail && (
        <div
          className="font-mono text-[11px] text-muted-foreground mt-1 truncate"
          title={detailTitle}
        >
          {detail}
        </div>
      )}
    </div>
  )
}
