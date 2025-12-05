'use client'

import React, { useMemo, type ReactNode, type CSSProperties } from 'react'
import styles from './wave.module.css'

type WaveDirection = 'up' | 'down'
type MovementDirection = 'left' | 'right'

interface WaveProps {
  height?: number
  amplitude?: number
  waveLength?: number
  fillColor?: string
  direction?: WaveDirection
  movementDirection?: MovementDirection
  animationSpeed?: number
  className?: string        // 外层容器额外 class
  innerClassName?: string   // 附加到波浪内部 div 的 class（除了 .wave-base）
  children?: ReactNode
}

// 生成 SVG 正弦曲线路径
function generateSineWavePath(
  width: number,
  height: number,
  amplitude: number,
  waveLength: number,
  direction: WaveDirection,
): string {
  const points: string[] = []

  const numberOfWaves = Math.ceil(width / waveLength)
  const totalWavesWidth = numberOfWaves * waveLength

  const step = 1
  const baseY = direction === 'up' ? amplitude : height - amplitude

  points.push(`M 0 ${baseY}`)

  const factor = (Math.PI * 2) / waveLength

  for (let x = 0; x <= totalWavesWidth; x += step) {
    const deltaY = amplitude * Math.sin(factor * x)
    const y = direction === 'up' ? baseY - deltaY : baseY + deltaY
    points.push(`L ${x} ${y}`)
  }

  const closeY = direction === 'up' ? height : 0
  points.push(`L ${totalWavesWidth} ${closeY}`)
  points.push(`L 0 ${closeY} Z`)

  return points.join(' ')
}

// 生成 mask-image（使用 data URI，避免 btoa + SSR 问题）
function buildMaskImage(
  width: number,
  fullHeight: number,
  amplitude: number,
  waveLength: number,
  direction: WaveDirection,
): string {
  const path = generateSineWavePath(width, fullHeight, amplitude, waveLength, direction)
  const svg = `<svg width="${width}" height="${fullHeight}" xmlns="http://www.w3.org/2000/svg">
    <path d="${path}" />
  </svg>`

  const encoded = encodeURIComponent(svg)
  return `url("data:image/svg+xml;utf8,${encoded}")`
}

export default function Wave(props: WaveProps) {
  const {
    height = 40,
    amplitude = 14,
    waveLength = 250,
    fillColor = 'oklch(95% 0.10 var(--chromatic-hue))',
    direction = 'down',
    movementDirection = 'left',
    animationSpeed = 50,
    className,
    innerClassName,
    children,
  } = props

  const fullHeight = height + amplitude * 2

  const maskImage = useMemo(
    () => buildMaskImage(waveLength, fullHeight, amplitude, waveLength, direction),
    [waveLength, fullHeight, amplitude, direction],
  )

  const waveStyle: CSSProperties = {
    background: fillColor,
    height: fullHeight,
    maskImage,
    WebkitMaskImage: maskImage,
    ['--wave-translate' as any]: `${-waveLength}px`,
    ['--animation-duration' as any]: `${waveLength / animationSpeed}s`,
    animationDirection: movementDirection === 'left' ? 'normal' : 'reverse',
  }

  return (
    <div className={`${styles.waveContainer} ${className ?? ''}`}>
      {children}

      <div className={styles.waveMaskWrapper}>
        <div
          className={`${styles.wave} wave-base ${innerClassName ?? ''}`}
          style={waveStyle}
        />
      </div>
    </div>
  )
}
