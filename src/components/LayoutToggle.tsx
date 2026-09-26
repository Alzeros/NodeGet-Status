import { LayoutGrid, Table as TableIcon } from 'lucide-react'
import { cn } from '../utils/cn'
import type { NodeLayout } from '../types'

const ITEMS: { value: NodeLayout; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { value: 'cards', label: '卡片', icon: LayoutGrid, hint: '卡片：逐台浏览' },
  { value: 'table', label: '表格', icon: TableIcon, hint: '表格：一屏看全、按列排序、异常置顶' },
]

/**
 * 节点页顶部的布局开关。卡片和表格是同一批机器的两种看法，
 * 不值一个顶层视图，所以从导航栏的视图菜单降到这里；筛选、排序、搜索两种布局共用。
 */
export function LayoutToggle({
  value,
  onChange,
}: {
  value: NodeLayout
  onChange: (v: NodeLayout) => void
}) {
  return (
    <div role="radiogroup" aria-label="节点布局" className="inline-flex rounded-lg bg-secondary/40 p-0.5">
      {ITEMS.map(({ value: v, label, icon: Icon, hint }) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            onClick={() => onChange(v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
