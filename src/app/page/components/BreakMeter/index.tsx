'use client'

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import styles from './index.module.css'

export type BreakMeterPhase = 'safe' | 'warm' | 'critical'

export type BreakMeterHandle = {
  /** 增加破防值（自动 clamp 0-100，触发 +分动画） */
  addRage: (amount: number) => void
  /** 重置为 0 */
  reset: () => void
  /** 设置为指定值（自动 clamp 0-100） */
  set: (value: number) => void
  /** 获取当前值 */
  get: () => number
}

type Floater = { id: string; amount: number }

export type BreakMeterProps = {
  /** 初始值 */
  initialValue?: number
  /** 最大值，默认 100 */
  max?: number
  /** 阶段阈值（默认 [50, 80]） */
  thresholds?: readonly [number, number]
  /** 满值触发（比如弹窗/Toast/音效），默认会自动 reset（可关闭 autoReset） */
  onOverload?: (value: number) => void
  /** 满值后是否自动重置（默认 true） */
  autoReset?: boolean
  /** 满值后延迟多久重置（默认 500ms） */
  overloadResetDelayMs?: number
  /** 是否显示标题行 */
  showHeader?: boolean
  /** 标题文案 */
  title?: string
  /** className 透传 */
  className?: string
  /** 受控模式：外部传值（不传则内部自管） */
  value?: number
  /** 受控模式：值变化回调 */
  onChange?: (value: number) => void
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

const BreakMeter = forwardRef<BreakMeterHandle, BreakMeterProps>(
  (
    {
      initialValue = 0,
      max = 100,
      thresholds = [50, 80],
      onOverload,
      autoReset = true,
      overloadResetDelayMs = 500,
      showHeader = true,
      title = 'BREAK METER',
      className,
      value,
      onChange,
    },
    ref
  ) => {
    const isControlled = typeof value === 'number'
    const [inner, setInner] = useState(() => clamp(initialValue, 0, max))
    const rage = isControlled ? clamp(value!, 0, max) : inner

    const [activeCursor, setActiveCursor] = useState(false)
    const activeTimer = useRef<number | null>(null)

    const [floaters, setFloaters] = useState<Floater[]>([])
    const removeTimers = useRef<Map<string, number>>(new Map())

    const [t1, t2] = thresholds

    const phase: BreakMeterPhase = useMemo(() => {
      if (rage < t1) return 'safe'
      if (rage < t2) return 'warm'
      return 'critical'
    }, [rage, t1, t2])

    const pct = useMemo(() => {
      if (max <= 0) return 0
      return Math.round((rage / max) * 100)
    }, [rage, max])

    const setRage = useCallback(
      (next: number) => {
        const clamped = clamp(next, 0, max)
        if (!isControlled) setInner(clamped)
        onChange?.(clamped)
      },
      [isControlled, max, onChange]
    )

    const flashCursor = useCallback(() => {
      setActiveCursor(true)
      if (activeTimer.current) window.clearTimeout(activeTimer.current)
      activeTimer.current = window.setTimeout(() => setActiveCursor(false), 200)
    }, [])

    const showFloatingScore = useCallback((amount: number) => {
      const id = uid()
      setFloaters((prev) => [...prev, { id, amount }])

      const timer = window.setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== id))
        removeTimers.current.delete(id)
      }, 1000)

      removeTimers.current.set(id, timer)
    }, [])

    const reset = useCallback(() => {
      setRage(0)
    }, [setRage])

    const addRage = useCallback(
      (amount: number) => {
        if (!Number.isFinite(amount) || amount === 0) return

        const next = clamp(rage + amount, 0, max)
        setRage(next)

        flashCursor()
        showFloatingScore(amount)

        if (next >= max) {
          onOverload?.(next)
          if (autoReset) {
            window.setTimeout(() => reset(), overloadResetDelayMs)
          }
        }
      },
      [
        rage,
        max,
        setRage,
        flashCursor,
        showFloatingScore,
        onOverload,
        autoReset,
        reset,
        overloadResetDelayMs,
      ]
    )

    useImperativeHandle(
      ref,
      () => ({
        addRage,
        reset,
        set: (v: number) => setRage(v),
        get: () => rage,
      }),
      [addRage, reset, setRage, rage]
    )

    useEffect(() => {
      return () => {
        if (activeTimer.current) window.clearTimeout(activeTimer.current)
        for (const t of removeTimers.current.values()) window.clearTimeout(t)
        removeTimers.current.clear()
      }
    }, [])

    const valColorVar =
      phase === 'safe' ? 'var(--primary)' : phase === 'warm' ? 'var(--gold)' : 'var(--danger)'

    return (
      <div className={[styles.rageContainer, className].filter(Boolean).join(' ')}>
        {showHeader && (
          <div className={styles.rageHeader}>
            <span className='text-app'>{title}</span>
            <span className={styles.rageVal} style={{ color: valColorVar }}>
              {pct}%
            </span>
          </div>
        )}

        <div
          className={[
            styles.rageTrack,
            phase === 'critical' ? styles.critical : '',
          ].join(' ')}
        >
          <div
            className={[
              styles.rageBar,
              phase !== 'safe' ? styles.flameMode : '',
              activeCursor ? styles.active : '',
            ].join(' ')}
            style={{ width: `${pct}%` }}
          />

          {/* +分浮动动画 */}
          <div className={styles.scoreFloaterAnchor}>
            {floaters.map((f) => (
              <div key={f.id} className={styles.floatingScore}>
                +{f.amount}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }
)

BreakMeter.displayName = 'BreakMeter'

export default BreakMeter;
