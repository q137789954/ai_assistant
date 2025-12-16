'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'

/**
 * Textarea 组件的样式变体定义。
 *
 * 与 `Input` 保持一致的视觉与交互规范：
 * - 统一的 focus ring
 * - 统一的 disabled 表现
 * - 提供简单的尺寸与错误态（invalid）
 *
 * 使用示例：
 * - `<Textarea placeholder="请输入描述" />`
 * - `<Textarea resize="none" rows={1} />`（例如聊天输入区固定高度）
 * - `<Textarea invalid aria-invalid="true" />`
 */
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
        /**
         * 默认行高与最小高度，适合正文输入。
         */
        default: 'min-h-[96px] leading-6',
        /**
         * 更紧凑的文本域。
         */
        sm: 'min-h-[80px] leading-5',
        /**
         * 更宽松、更适合长文本的文本域。
         */
        lg: 'min-h-[128px] text-base leading-7',
      },
      invalid: {
        false: 'border-slate-200 hover:border-slate-300',
        true: 'border-red-300 hover:border-red-400 focus-visible:ring-red-300',
      },
      /**
       * 控制用户是否可手动拖拽改变高度。
       * - 表单里通常建议允许 resize-y
       * - 聊天输入区可能希望固定高度：传 `resize="none"`
       */
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
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {
  /**
   * 是否以 Radix Slot 方式渲染子元素（同 Input）。
   */
  asChild?: boolean
}

/**
 * 文本域组件。
 *
 * 说明：
 * - `rows`、`value`、`onChange` 等原生属性保持不变，直接透传给 textarea（或 asChild 的子元素）。
 * - 通过 `resize` 变体控制是否允许拖拽调整高度。
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, invalid, resize, asChild = false, ...props }, ref) => {
    const classes = clsx(textareaVariants({ size, invalid, resize }), className)

    if (asChild) {
      return (
        <Slot
          className={classes}
          ref={ref as React.ForwardedRef<React.ElementRef<typeof Slot>>}
          {...props}
        />
      )
    }

    return <textarea ref={ref} className={classes} {...props} />
  }
)
Textarea.displayName = 'Textarea'

export { Textarea, textareaVariants }
