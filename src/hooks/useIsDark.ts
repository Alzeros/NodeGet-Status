import { useEffect, useState } from 'react'

/**
 * 观察 <html> 上的 dark 类。
 * canvas 类组件（ECharts）读不到 CSS 变量，只能拿到布尔值自己换色板。
 */
export function useIsDark() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setIsDark(el.classList.contains('dark')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return isDark
}
