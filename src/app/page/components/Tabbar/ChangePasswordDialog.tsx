import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/app/components/ui";

type ChangePasswordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * 修改密码弹窗组件
 * - 内部维护原密码/新密码表单与提交状态
 * - 通过父组件受控的 open/onOpenChange 控制显示与关闭
 */
const ChangePasswordDialog = ({ open, onOpenChange }: ChangePasswordDialogProps) => {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 弹窗关闭时重置表单，避免旧状态残留
  useEffect(() => {
    if (!open) {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setNotice(null);
    }
  }, [open]);

  // 提交修改密码请求，校验必填项与一致性
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!oldPassword || !newPassword || !confirmPassword) {
      setError("请完整填写原密码与新密码");
      return;
    }
    if (newPassword.length < 6) {
      setError("新密码长度不足（至少 6 位）");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = (await res.json().catch(() => null)) as
        | { success: true; data: { message?: string } }
        | { success: false; message?: string }
        | null;

      if (!res.ok || !data || !("success" in data) || !data.success) {
        setError(
          (data && "message" in data && data.message) || "修改失败，请稍后重试",
        );
        return;
      }

      setNotice(data.data.message || "密码已更新，请使用新密码重新登录");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={520}>
      <DialogContent className="bg-slate-900 text-secondary border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-white">
            修改密码
          </DialogTitle>
          <p className="text-sm text-white">
            为保障账号安全，需要先验证原密码，再设置新密码。
          </p>
        </DialogHeader>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-white">
            原密码
            <Input
              type="password"
              autoComplete="current-password"
              className="mt-2 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </label>

          <label className="block text-sm text-white">
            新密码（至少 6 位）
            <Input
              type="password"
              autoComplete="new-password"
              className="mt-2 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>

          <label className="block text-sm text-white">
            确认新密码
            <Input
              type="password"
              autoComplete="new-password"
              className="mt-2 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>

          {error && (
            <p className="rounded-xl border border-red-300 bg-red-50/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-emerald-400/40 bg-emerald-50/10 px-3 py-2 text-sm text-emerald-200">
              {notice}
            </p>
          )}

          <DialogFooter className="mt-2">
            <button
              type="button"
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 hover:bg-white/5"
              onClick={() => onOpenChange(false)}
            >
              取消
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[rgb(204,255,0)] px-4 py-2 text-sm font-bold text-slate-900 hover:bg-lime-300 disabled:opacity-60 cursor-pointer"
              disabled={
                submitting ||
                !oldPassword.trim() ||
                !newPassword.trim() ||
                !confirmPassword.trim()
              }
            >
              {submitting ? "提交中..." : "确认修改"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;
