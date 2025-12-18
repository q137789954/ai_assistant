'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'
import { Input as AntdInput } from 'antd'
import type { InputProps as AntdInputProps, InputRef as AntdInputRef } from 'antd/es/input'

/**
 * 统一定义输入框的交互与视觉规则，保持与按钮/对话框一致的 focus 环境与圆角。
 */
const inputVariants = cva(
  [
    'flex w-full rounded-md px-3 py-2 text-sm',
    'border bg-white text-slate-900 shadow-sm',
    'placeholder:text-slate-400',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      uiSize: {
        default: 'h-10',
        sm: 'h-9 text-sm',
        lg: 'h-11 text-base',
      },
      invalid: {
        false: 'border-slate-200 hover:border-slate-300',
        true: 'border-red-300 hover:border-red-400 focus-visible:ring-red-300',
      },
    },
    defaultVariants: {
      uiSize: 'default',
      invalid: false,
    },
  }
)

export interface InputProps
  extends Omit<AntdInputProps, 'size'>,
    VariantProps<typeof inputVariants> {}

/**
 * 使用 Ant Design 的 Input 作为基础，className 通过 variants 统一管理。
 */
const Input = React.forwardRef<AntdInputRef, InputProps>(
  ({ className, uiSize, invalid, ...props }, ref) => {
    const classes = clsx(inputVariants({ uiSize, invalid }), className)
    return <AntdInput ref={ref} className={classes} {...props} />
  }
)
Input.displayName = 'Input'

export { Input, inputVariants }
