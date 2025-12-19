'use client'

import * as React from 'react'
import { Modal, type ModalProps } from 'antd'
import clsx from 'clsx'

/**
 * 统一封装 Ant Design Modal，提供 open/onOpenChange 接口以及默认的遮罩/边距控制。
 */
export interface DialogProps extends Omit<ModalProps, 'open' | 'footer'> {
  open: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  footer?: React.ReactNode
}

const Dialog = ({
  open,
  onOpenChange,
  footer = null,
  centered = true,
  width = 560,
  maskClosable = true,
  closable = false,
  styles,
  bodyStyle,
  className,
  children,
  ...props
}: DialogProps) => {
  // 合并样式以保持默认 padding/背景，并兼容旧的 bodyStyle 配置
  const mergedStyles: ModalProps['styles'] = {
    ...(styles ?? {}),
    body: {
      padding: 0,
      backgroundColor: 'transparent',
      ...(styles?.body ?? {}),
      ...bodyStyle,
    },
  }

  return (
    <Modal
      open={open}
      footer={footer}
      onCancel={() => onOpenChange?.(false)}
      centered={centered}
      width={width}
      maskClosable={maskClosable}
      closable={closable}
      styles={mergedStyles}
      className={clsx('custom-dialog-root', className)}
      {...props}
    >
      {children}
    </Modal>
  )
}
Dialog.displayName = 'Dialog'

const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(
        'rounded-[20px] border border-slate-200 bg-white p-6 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
DialogContent.displayName = 'DialogContent'

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx('flex flex-col gap-2 text-left', className)}
    {...props}
  />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx(
      'mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-2',
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={clsx('text-lg font-semibold text-slate-900', className)} {...props} />
  )
)
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={clsx('text-sm text-slate-500', className)} {...props} />
  )
)
DialogDescription.displayName = 'DialogDescription'

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
}
