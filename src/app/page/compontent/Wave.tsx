'use client'

import React, { useMemo, type ReactNode, type CSSProperties } from 'react'
import styles from './wave.module.css'

// 保证数字在服务端和浏览器端一致，所以路径字符串要经过统一的截断/格式化
function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString()
}

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

  points.push(`M 0 ${formatNumber(baseY)}`)

  const factor = (Math.PI * 2) / waveLength

  for (let x = 0; x <= totalWavesWidth; x += step) {
    const deltaY = amplitude * Math.sin(factor * x)
    const y = direction === 'up' ? baseY - deltaY : baseY + deltaY
    points.push(`L ${formatNumber(x)} ${formatNumber(y)}`)
  }

  const closeY = direction === 'up' ? height : 0
  points.push(`L ${formatNumber(totalWavesWidth)} ${formatNumber(closeY)}`)
  points.push(`L 0 ${formatNumber(closeY)} Z`)

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

  const maskHeight = height

  const maskImage = useMemo(
    () => buildMaskImage(waveLength, maskHeight, amplitude, waveLength, direction),
    [waveLength, maskHeight, amplitude, direction],
  )

  const waveStyle: CSSProperties = {
    background: fillColor,
    height: maskHeight,
    maskImage,
    WebkitMaskImage: maskImage,
    ['--wave-translate' as any]: `${-waveLength}px`,
    ['--animation-duration' as any]: `${waveLength / animationSpeed}s`,
    animationDirection: movementDirection === 'left' ? 'normal' : 'reverse',
  }

  const wrapperStyle: CSSProperties = {
    ['--wave-height' as any]: `${height}px`,
  }

  return (
    <div className={`${styles.waveContainer} ${className ?? ''}`}>
      {children}

      <div className={styles.waveMaskWrapper} style={wrapperStyle}>
        <div
          className={`${styles.wave} ${styles.waveBase} ${innerClassName ?? ''}`}
          style={waveStyle}
        />
      </div>
    </div>
  )
}
