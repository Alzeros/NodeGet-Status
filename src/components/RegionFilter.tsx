import { cn } from '../utils/cn'
import { Flag } from './Flag'
import React from "react";

interface Props {
  regions: { code: string; count: number }[]
  total: number
  active: string | null
  onChange: (code: string | null) => void
  layout?: 'horizontal' | 'vertical'
}

export function RegionFilter({ regions, total, active, onChange, layout = 'horizontal' }: Props) {
  if (regions.length === 0) return null

  return (
    <div className={cn(
      "flex flex-wrap items-center gap-2",
      layout === 'vertical' && "grid grid-cols-2 gap-1.5 w-full"
    )}>
      <Chip
        selected={active === null}
        onClick={() => onChange(null)}
        layout={layout}
        className={layout === 'vertical' ? 'col-span-2' : ''}
      >
        <span>全部</span>
        <span className="text-[10px] opacity-70 ml-auto">{total}</span>
      </Chip>
      {regions.map(r => (
        <Chip key={r.code} selected={active === r.code} onClick={() => onChange(r.code)} layout={layout}>
          <Flag code={r.code} className="w-4 h-3 shrink-0" />
          <span>{r.code}</span>
          <span className="text-[10px] opacity-70 ml-auto">{r.count}</span>
        </Chip>
      ))}
    </div>
  )
}

function Chip({
  selected,
  onClick,
  children,
  layout = 'horizontal',
  className,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  layout?: 'horizontal' | 'vertical'
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors',
        layout === 'vertical' && 'rounded-lg py-1.5 justify-start w-full',
        selected
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-foreground/80 border-border hover:bg-accent',
        className
      )}
    >
      {children}
    </button>
  )
}

