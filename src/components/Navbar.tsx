import { useEffect, useRef, useState } from 'react'
import { ViewToggle } from './ViewToggle'
import { ThemeToggle } from './ThemeToggle'
import { StyleMenu } from './StyleMenu'
import type { View } from '../types'

interface Props {
  siteName: string
  logo?: string
  view: View
  onView: (v: View) => void
}

/** 导航栏只留站点级的东西：视图、样式、主题。搜索和排序只有节点页用得上，在那页的顶栏里 */
export function Navbar({ siteName, logo, view, onView }: Props) {
  const [stuck, setStuck] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onScroll = () => {
      const h = headerRef.current?.offsetHeight ?? 60
      setStuck(window.scrollY > h)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      ref={headerRef}
      className={`sticky top-0 z-50 transition-all duration-300 ${
        stuck
          ? 'border-b border-border/30 bg-background/60 backdrop-blur-md shadow-sm'
          : 'border-b border-transparent bg-transparent backdrop-blur-none'
      }`}
    >
      <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-2 px-6 sm:px-8 lg:px-12 xl:px-16 py-3">
        <a
          href="./"
          className="flex items-center gap-2 min-w-0 shrink-0 hover:opacity-80 transition-opacity"
        >
          {logo && <img src={logo} alt="" className="w-6 h-6 rounded shrink-0" />}
          <span className="font-semibold tracking-wide truncate">{siteName}</span>
        </a>
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <ViewToggle value={view} onChange={onView} />
          <StyleMenu />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
