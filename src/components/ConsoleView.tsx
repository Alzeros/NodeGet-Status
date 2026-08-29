import { memo, useEffect, useRef } from 'react'
import { Progress } from './ui/progress'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { NodeDetail } from './NodeDetail'
import { pct } from '../utils/format'
import { deriveUsage, displayName } from '../utils/derive'
import { cn, loadColor } from '../utils/cn'
import { avgLatency, type LatencyTracks } from '../utils/latency'
import type { Node } from '../types'
import type { NodeStatusCategory } from '../utils/stableStatus'
import type { BackendPool } from '../api/pool'

export interface ConsoleViewProps {
  nodes: Node[]
  latencyTracks: Map<string, LatencyTracks>
  statuses: Map<string, NodeStatusCategory>
  /** 全局选中节点（可能已被筛选出列表，仍应在右栏展示） */
  selectedNode: Node | null
  pool: BackendPool | null
  showSource: boolean
  /** true = 宽屏主从布局；false = 退化为纯列表，点击走整页详情 */
  embedded: boolean
}

interface RowProps {
  node: Node
  latencyTracks?: LatencyTracks
  status?: NodeStatusCategory
  active: boolean
}

function rowEqual(prev: RowProps, next: RowProps) {
  if (prev.status !== next.status) return false
  if (prev.latencyTracks !== next.latencyTracks) return false
  if (prev.active !== next.active) return false
  const pn = prev.node, nn = next.node
  return pn.uuid === nn.uuid
    && pn.online === nn.online
    && pn.dynamic === nn.dynamic
    && pn.meta === nn.meta
}

const ConsoleRow = memo<RowProps>(function ConsoleRow({ node, latencyTracks, status, active }) {
  const u = deriveUsage(node)
  const latency = avgLatency(latencyTracks)

  return (
    <a
      href={`#${encodeURIComponent(node.uuid)}`}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'block rounded-xl border px-3 py-2 transition-colors',
        active
          ? 'border-primary/30 bg-primary/10'
          : 'border-transparent hover:bg-accent/70',
        !node.online && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <StatusDot online={node.online} status={status} />
        <Flag code={node.meta?.region} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium" title={displayName(node)}>
          {displayName(node)}
        </span>
        <span
          className={cn(
            'shrink-0 font-mono text-[11px] tabular-nums',
            node.online ? 'text-muted-foreground' : 'text-rose-500',
          )}
        >
          {node.online ? (latency != null ? `${latency.toFixed(0)}ms` : '—') : '离线'}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex-1 min-w-0" title={`CPU ${pct(u.cpu)}`}>
          <Progress value={u.cpu} indicatorClassName={loadColor(u.cpu)} className="h-[3px]" />
        </span>
        <span className="flex-1 min-w-0" title={`内存 ${pct(u.mem)}`}>
          <Progress value={u.mem} indicatorClassName={loadColor(u.mem)} className="h-[3px]" />
        </span>
      </div>
    </a>
  )
}, rowEqual)

export function ConsoleView({
  nodes,
  latencyTracks,
  statuses,
  selectedNode,
  pool,
  showSource,
  embedded,
}: ConsoleViewProps) {
  // 无选中时默认展示列表第一台，不写入 hash，保持 URL 干净
  const paneNode = selectedNode ?? nodes[0] ?? null
  const activeUuid = embedded ? paneNode?.uuid ?? null : null
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeUuid) return
    railRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeUuid])

  const rows = nodes.map(n => (
    <ConsoleRow
      key={n.uuid}
      node={n}
      latencyTracks={latencyTracks.get(n.uuid)}
      status={statuses.get(n.uuid)}
      active={n.uuid === activeUuid}
    />
  ))

  // 窄屏退化：纯列表，点击行进入整页详情（沿用 hash 路由）
  if (!embedded) {
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{rows}</div>
  }

  return (
    <div className="flex gap-6">
      <aside className="w-[272px] shrink-0">
        <div
          ref={railRef}
          className="sticky top-[60px] max-h-[calc(100vh-80px)] overflow-y-auto sidebar-scroll pb-4"
        >
          <div className="px-1 pb-2 text-[11px] font-medium text-muted-foreground">
            节点 · {nodes.length}
          </div>
          <div className="flex flex-col gap-1">{rows}</div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        {paneNode ? (
          <NodeDetail
            node={paneNode}
            onClose={() => {}}
            showSource={showSource}
            pool={pool}
            embedded
          />
        ) : (
          <div className="py-24 text-center text-sm text-muted-foreground">
            在左侧选择一个节点
          </div>
        )}
      </div>
    </div>
  )
}
