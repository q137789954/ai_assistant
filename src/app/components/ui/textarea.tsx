'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'
import { Input as AntdInput } from 'antd'
import type { TextAreaProps as AntdTextAreaProps } from 'antd/es/input'

const textareaVariants = cva(
  [
    'flex w-full rounded-md px-3 py-2 text-sm',
    'border bg-white text-slate-900 shadow-sm',
    'placeholder:text-slate-400',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      size: {
        default: 'min-h-[96px] leading-6',
        sm: 'min-h-[80px] leading-5',
        lg: 'min-h-[128px] text-base leading-7',
      },
      invalid: {
        false: 'border-slate-200 hover:border-slate-300',
        true: 'border-red-300 hover:border-red-400 focus-visible:ring-red-300',
      },
      resize: {
        none: 'resize-none',
        y: 'resize-y',
      },
    },
    defaultVariants: {
      size: 'default',
      invalid: false,
      resize: 'y',
    },
  }
)

export interface TextareaProps
  extends Omit<AntdTextAreaProps, 'size'>,
    VariantProps<typeof textareaVariants> {}

/**
 * 使用 Ant Design TextArea 作为基础，保持与 Input 相同的视觉规范。
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, invalid, resize, ...props }, ref) => {
    const classes = clsx(textareaVariants({ size, invalid, resize }), className)
    return <AntdInput.TextArea ref={ref} className={classes} {...props} />
  }
)
Textarea.displayName = 'Textarea'

export { Textarea, textareaVariants }
