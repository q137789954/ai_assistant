'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'
import { Button as AntdButton } from 'antd'
import type { ButtonProps as AntdButtonProps } from 'antd'

/**
 * 统一定义按钮的基础样式与变体，方便通过参数快速切换视觉效果。
 * 同时使用 class-variance-authority 管理尺寸、主题、是否撑满等属性。
 */
const buttonVariants = cva(
  'cursor-pointer inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-slate-900 text-white hover:bg-slate-900/90 focus-visible:ring-slate-400',
        destructive: 'bg-red-600 text-white hover:bg-red-600/90 focus-visible:ring-red-300',
        outline: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-100 focus-visible:ring-slate-400',
        secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 focus-visible:ring-slate-400',
        ghost: 'bg-transparent text-slate-900 hover:bg-slate-100 focus-visible:ring-slate-400',
        link: 'bg-transparent underline-offset-4 hover:underline text-slate-900 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 py-0',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-6',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends Omit<AntdButtonProps, 'size' | 'variant'>,
    VariantProps<typeof buttonVariants> {
  /**
   * 支持使用 Radix Slot 作为父组件控制最终渲染元素（用于配合 Link 等组件）。
   */
  asChild?: boolean
}

/**
 * 使用 Ant Design Button 作为基础，保持原有变体与 slot 支持，方便统一样式。
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size: uiSize,
      fullWidth,
      ...props
    },
    ref
  ) => {
    const classes = clsx(buttonVariants({ variant, size: uiSize, fullWidth }), className)

    return (
      <AntdButton
        ref={ref as React.ForwardedRef<React.ElementRef<typeof AntdButton>>}
        className={classes}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
