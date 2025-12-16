'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'

/**
 * Input 组件的样式变体定义。
 *
 * 设计目标：
 * - 保持与现有 `Button`/`Dialog` 相同的交互规范（focus ring、disabled、圆角等）。
 * - 提供最小但实用的变体：尺寸与错误态（invalid）。
 * - 通过 Radix `Slot` 支持 `asChild`，便于与 `label`、自定义组件或表单库做组合。
 *
 * 使用示例：
 * - `<Input placeholder="请输入用户名" />`
 * - `<Input type="password" placeholder="请输入密码" />`
 * - `<Input invalid aria-invalid="true" />`
 */
const inputVariants = cva(
  [
    // 布局与大小
    'flex w-full rounded-md px-3 py-2 text-sm',
    // 视觉与边框
    'border bg-white text-slate-900 shadow-sm',
    // 占位符
    'placeholder:text-slate-400',
    // 交互（对齐 Button 的 focus-visible 行为）
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    // 禁用态
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      /**
       * 避免与原生 `<input size={number} />` 属性冲突，这里使用 `uiSize` 作为变体名。
       */
      uiSize: {
        /**
         * 默认高度与内边距：适配大多数表单布局。
         */
        default: 'h-10',
        /**
         * 更紧凑的输入框：适配工具栏、小型弹窗等。
         */
        sm: 'h-9 text-sm',
        /**
         * 更醒目的输入框：适配主表单关键字段。
         */
        lg: 'h-11 text-base',
      },
      invalid: {
        /**
         * 正常态：使用浅色边框，hover 时稍加深。
         */
        false: 'border-slate-200 hover:border-slate-300',
        /**
         * 错误态：边框与 focus ring 变为红色系。
         */
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
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {
  /**
   * 是否以 Radix Slot 方式渲染子元素。
   *
   * 常见用法：当你希望把样式“注入”到自定义输入组件时使用。
   * - `asChild={true}` 时，组件不会渲染 `<input />`，而是把 className/props 透传给子元素。
   */
  asChild?: boolean
}

/**
 * 输入框组件（受控与非受控均可）。
 *
 * 推荐：
 * - 受控：传入 `value` + `onChange`
 * - 非受控：传入 `defaultValue`
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, uiSize, invalid, asChild = false, type = 'text', ...props }, ref) => {
    const classes = clsx(inputVariants({ uiSize, invalid }), className)

    if (asChild) {
      return (
        <Slot
          className={classes}
          ref={ref as React.ForwardedRef<React.ElementRef<typeof Slot>>}
          {...props}
        />
      )
    }

    return <input ref={ref} type={type} className={classes} {...props} />
  }
)
Input.displayName = 'Input'

export { Input, inputVariants }
