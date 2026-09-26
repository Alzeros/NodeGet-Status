import { BarChart3, Check, Globe, Server } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import type { View } from '../types'

const ITEMS: { value: View; label: string; icon: typeof Server }[] = [
  { value: 'nodes', label: '节点', icon: Server },
  { value: 'map', label: '地图', icon: Globe },
  { value: 'stats', label: '分析', icon: BarChart3 },
]

/**
 * 当前启用的视图集合。App 恢复 localStorage 里的视图时拿它校验——
 * 从前那边是手写的 if 白名单，漏了 'stats'，停在分析页刷新会被弹回卡片页。
 * 不在集合里的旧值（卡片/表格已降为节点页的布局，工作台/迷你已删）会回落到节点页。
 */
const ENABLED_VIEWS = new Set<string>(ITEMS.map(i => i.value))

export function isEnabledView(v: string | null | undefined): v is View {
  return !!v && ENABLED_VIEWS.has(v)
}

/**
 * 视图切换：收成单个按钮 + 下拉菜单，与 SortMenu / StyleMenu 同一套交互。
 * 原先是四格常驻的分段控件，在导航栏里横向占掉一大块——视图一次只会选一个，
 * 常驻展示三个没选中的选项换不来信息量。按钮上留着当前视图的图标与名称，
 * 收起后仍然一眼能看出"我在哪一页"。
 */
export function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const [open, setOpen] = useState(false)
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = ITEMS.find(i => i.value === value) ?? ITEMS[0]
  const CurrentIcon = current.icon

  useEffect(() => {
    if (open) setShow(true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`切换视图，当前为${current.label}`}
        title={`视图：${current.label}`}
        className="gap-1.5"
      >
        <CurrentIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{current.label}</span>
      </Button>
      {show && (
        <div
          role="menu"
          data-state={open ? 'open' : 'closed'}
          onAnimationEnd={() => {
            if (!open) setShow(false)
          }}
          className="absolute right-0 mt-1 w-32 origin-top-right z-20 rounded-md border bg-popover shadow-md py-1 fill-mode-forwards data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {ITEMS.map(({ value: v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={value === v}
              onClick={() => {
                onChange(v)
                setOpen(false)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-accent"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{label}</span>
              {value === v && <Check className="h-3.5 w-3.5 ml-auto shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
