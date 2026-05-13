import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function loadColor(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return 'bg-muted-foreground/40'
  if (v >= 90) return 'bg-rose-500'
  if (v >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function strokeColor(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return 'stroke-muted-foreground/40'
  if (v >= 90) return 'stroke-rose-500'
  if (v >= 70) return 'stroke-amber-500'
  return 'stroke-emerald-500'
}

export const REGION_BASELINE: Record<string, number> = {
  US: 180,
  HK: 70,
  CN: 50,
  TW: 100,
  KR: 100,
  IN: 100,
  JP: 100,
  SG: 90,
  EU: 200,
  DEFAULT: 200,
}

export interface NetworkQualityResult {
  status: 'green' | 'yellow' | 'red'
  ratio: number
  className: string
}

export function getNetworkColor(
  latency: number,
  lossRate: number,
  region?: string | null,
): NetworkQualityResult {
  const baseline = REGION_BASELINE[region?.trim().toUpperCase() || ''] || REGION_BASELINE.DEFAULT
  const R = latency / baseline

  const isRed = R > 1.5 || lossRate > 1
  const isYellow = R > 1.2 || lossRate > 0.1

  if (isRed) return { status: 'red', ratio: R, className: 'bg-rose-500' }
  if (isYellow) return { status: 'yellow', ratio: R, className: 'bg-amber-500' }
  return { status: 'green', ratio: R, className: 'bg-emerald-500' }
}
