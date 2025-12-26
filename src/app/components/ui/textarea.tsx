'use client'

import * as React from 'react'
import { Input as AntdInput } from 'antd'
import type { TextAreaProps as AntdTextAreaProps } from 'antd/es/input'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'

export const textareaVariants = cva(
  clsx(
    'flex w-full rounded-md p-3! text-xs! leading-4! text-white!',
    'border-default bg-[#222222]/40! shadow-sm',
    'placeholder:text-white/70!',
    'disabled:cursor-not-allowed disabled:opacity-50'
  )
)

export interface TextareaProps
  extends Omit<AntdTextAreaProps, 'size'>,
    VariantProps<typeof textareaVariants> {
  className?: string
}

/**
 * Ant Design TextArea 封装：保持与 Input 同一套视觉规范
 */
export const Textarea = React.forwardRef<TextAreaRef, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <AntdInput.TextArea
        ref={ref}
        className={clsx(textareaVariants(), className)}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'
