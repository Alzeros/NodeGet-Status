import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Palette } from 'lucide-react'
import { Button } from './ui/button'
import { useStyle, type StyleId } from '../hooks/useStyle'

// 缩略预览是静态的（不跟随当前明暗）：只表达风格质感差异，不表达配色
const OPTIONS: { value: StyleId; label: string; hint: string; swatch: CSSProperties }[] = [
  {
    value: 'default',
    label: '玻璃拟态',
    hint: '通透模糊 · 柔光背景',
    swatch: {
      background: 'linear-gradient(135deg, rgba(26,114,209,0.3), rgba(255,255,255,0.75))',
      border: '1px solid rgba(255,255,255,0.7)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
    },
  },
  {
    value: 'neu',
    label: '新拟物',
    hint: '浮雕阴影 · 哑光底面',
    swatch: {
      background: '#ebe6dd',
      boxShadow:
        '2px 2px 4px rgba(190,175,155,0.9), -2px -2px 4px rgba(255,255,255,0.95)',
    },
  },
  {
    value: 'term',
    label: '终端',
    hint: '等宽字体 · 荧光描边',
    swatch: {
      background: '#0c0f0c',
      border: '1px solid #2fae5f',
      boxShadow: '0 0 5px rgba(46,204,113,0.55)',
    },
  },
  {
    value: 'paper',
    label: '杂志·纸质',
    hint: '衬线字体 · 细线分栏',
    swatch: {
      background: '#f5f1e6',
      border: '1px solid #d8d2c0',
      borderTop: '3px double #9c3226',
    },
  },
]

export function StyleMenu() {
  const { style, setStyle } = useStyle()
  const [open, setOpen] = useState(false)
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
        size="icon"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="切换风格主题"
        title="风格主题"
      >
        <Palette className="h-4 w-4" />
      </Button>
      {show && (
        <div
          data-state={open ? 'open' : 'closed'}
          onAnimationEnd={() => {
            if (!open) setShow(false)
          }}
          className="absolute right-0 mt-1 w-44 origin-top-right z-20 rounded-md border bg-popover shadow-md py-1 fill-mode-forwards data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {OPTIONS.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setStyle(o.value)
                setOpen(false)
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm hover:bg-accent"
            >
              <span className="w-4 h-4 rounded-md shrink-0" style={o.swatch} />
              <span className="flex flex-col items-start leading-tight">
                <span>{o.label}</span>
                <span className="text-[10px] text-muted-foreground">{o.hint}</span>
              </span>
              {o.value === style && <Check className="h-3.5 w-3.5 ml-auto shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
