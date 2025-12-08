'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import type { GlobalsContextValue } from '@/app/providers/GlobalsProviders/types'
import { GlobalsContext } from '@/app/providers/GlobalsProviders'

/**
 * 客户端组件：负责展示麦克风权限被拒绝时的提示框，提示语音功能受限
 */
export const MicrophonePermissionDialog = () => {
  const context = React.useContext<GlobalsContextValue | undefined>(GlobalsContext)
  if (!context) {
    return null
  }

  const { permissionDialogOpen, setPermissionDialogOpen } = context

  return (
    <Dialog open={permissionDialogOpen} onOpenChange={setPermissionDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>麦克风权限已关闭</DialogTitle>
          <DialogDescription>
            语音功能需要麦克风权限才能正常工作，当前权限已被拒绝，建议前往浏览器设置重新授权后再次尝试。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            onClick={() => setPermissionDialogOpen(false)}
          >
            我知道了
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
