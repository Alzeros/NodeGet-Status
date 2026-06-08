import { cn } from '../utils/cn'
import type { NodeStatusCategory } from '../utils/stableStatus'

interface Props {
  online?: boolean
  status?: NodeStatusCategory
  className?: string
}

const statusConfig: Record<NodeStatusCategory, { bg: string; ring: string; label: string }> = {
  normal:  { bg: 'bg-emerald-500', ring: 'ring-emerald-500/25', label: '正常' },
  warning: { bg: 'bg-amber-500',  ring: 'ring-amber-500/25',  label: '注意' },
  risk:    { bg: 'bg-rose-500',   ring: 'ring-rose-500/25',   label: '风险' },
  offline: { bg: 'bg-gray-400',   ring: 'ring-gray-400/25',   label: '离线' },
}

export function StatusDot({ online, status, className }: Props) {
  const config = status ? statusConfig[status] : null
  const title = config ? config.label : online ? '在线' : '离线'
  const bg = config ? config.bg : online ? 'bg-emerald-500' : 'bg-rose-500'
  const ring = config ? config.ring : online ? 'ring-emerald-500/25' : 'ring-rose-500/25'

  return (
    <span
      title={title}
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        bg,
        'ring-2',
        ring,
        className,
      )}
    />
  )
}
