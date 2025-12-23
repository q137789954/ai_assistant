'use client'

import * as React from 'react'
import { Button as AntdButton } from 'antd'
import type { ButtonProps as AntdButtonProps } from 'antd'

/**
 * 你在业务中更容易理解的一层抽象：
 * - tone：语义色（primary/danger/success...）
 * - appearance：外观变体（solid/outlined/text/link...）
 * - size：sm/md/lg
 * - fullWidth：是否撑满父容器
 *
 * 其余所有 antd ButtonProps 都原样透传。
 */

export type AppButtonTone =
  | 'default'
  | 'primary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info'

export type AppButtonAppearance =
  | 'solid'
  | 'outlined'
  | 'filled'
  | 'dashed'
  | 'text'
  | 'link'

export type AppButtonSize = 'sm' | 'md' | 'lg'

const toneToAntdColor = (tone: AppButtonTone): AntdButtonProps['color'] => {
  // antd 支持 `default | primary | danger | PresetColors`
  // PresetColors: 'blue' | 'green' | 'gold' | 'volcano' ... :contentReference[oaicite:1]{index=1}
  switch (tone) {
    case 'primary':
      return 'primary'
    case 'danger':
      return 'danger'
    case 'success':
      return 'green'
    case 'warning':
      return 'gold'
    case 'info':
      return 'blue'
    case 'default':
    default:
      return 'default'
  }
}

const appearanceToAntdVariant = (
  appearance: AppButtonAppearance
): AntdButtonProps['variant'] => {
  // antd variant: outlined | dashed | solid | filled | text | link :contentReference[oaicite:2]{index=2}
  return appearance
}

const sizeToAntdSize = (size: AppButtonSize): AntdButtonProps['size'] => {
  switch (size) {
    case 'sm':
      return 'small'
    case 'lg':
      return 'large'
    case 'md':
    default:
      return 'middle'
  }
}

export interface AppButtonProps
  extends Omit<AntdButtonProps, 'color' | 'variant' | 'size'> {
  /** 语义色：默认 primary */
  tone?: AppButtonTone
  /** 外观变体：默认 solid */
  appearance?: AppButtonAppearance
  /** 尺寸：默认 md */
  size?: AppButtonSize
  /** 是否撑满父容器（映射到 antd 的 block） */
  fullWidth?: boolean

  /**
   * 仍然允许你在极少数场景直接指定 antd 的 color/variant（优先级最高）
   * 例如：color="volcano" variant="outlined"
   */
  color?: AntdButtonProps['color']
  variant?: AntdButtonProps['variant']
}

export const AppButton = React.forwardRef<
  React.ElementRef<typeof AntdButton>,
  AppButtonProps
>((props, ref) => {
  const {
    tone = 'primary',
    appearance = 'solid',
    size = 'md',
    fullWidth,
    block,

    // 显式覆盖（优先级最高）
    color: colorOverride,
    variant: variantOverride,

    ...rest
  } = props

  const color = colorOverride ?? toneToAntdColor(tone)
  const variant = variantOverride ?? appearanceToAntdVariant(appearance)
  const antdSize = sizeToAntdSize(size)

  return (
    <AntdButton
      ref={ref}
      {...rest}
      color={color}
      variant={variant}
      size={antdSize}
      block={block ?? Boolean(fullWidth)}
    />
  )
})
AppButton.displayName = 'AppButton'

// 可选：导出默认别名，方便替换项目里 Button 组件
export const Button = AppButton
