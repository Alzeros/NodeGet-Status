import { useEffect, useRef, useState } from 'react'

const DURATION = 600

export function useSmoothNumber(target: number, deps: React.DependencyList = []) {
  const [display, setDisplay] = useState(target)
  const startRef = useRef(0)
  const fromRef = useRef(target)
  const toRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    fromRef.current = display
    toRef.current = target
    startRef.current = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startRef.current
      const progress = Math.min(elapsed / DURATION, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      const value = fromRef.current + (toRef.current - fromRef.current) * ease
      setDisplay(value)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return display
}
