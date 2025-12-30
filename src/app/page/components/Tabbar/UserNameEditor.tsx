"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { message } from "antd";
import { Pencil } from "lucide-react";
import { Input, Button } from "@/app/components/ui";

type UserNameEditorProps = {
  /** 父组件传入的当前用户名 */
  name: string;
  /** 更新成功后回调，便于父组件同步展示/首字母 */
  onNameUpdated?: (name: string) => void;
};

/**
 * 用户名编辑组件
 * - 展示当前用户名
 * - 点击铅笔进入编辑态，支持提交/取消
 * - 成功后回填展示并回调父组件
 */
export default function UserNameEditor({ name, onNameUpdated }: UserNameEditorProps) {
  const [displayName, setDisplayName] = useState(name ?? "");
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(name ?? "");
  const [saving, setSaving] = useState(false);
  const { update: updateSession } = useSession();

  // 外部 session 切换时同步内部展示；编辑中不抢输入框
  useEffect(() => {
    setDisplayName(name ?? "");
    if (!editing) {
      setInputValue(name ?? "");
    }
  }, [name, editing]);

  const handleStartEdit = useCallback(() => {
    setEditing(true);
    setInputValue(displayName);
  }, [displayName]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setInputValue(displayName);
  }, [displayName]);

  const handleSave = useCallback(async () => {
    const nextName = inputValue.trim();
    if (!nextName) {
      message.warning("请输入用户名");
      return;
    }
    if (nextName.length > 32) {
      message.warning("用户名不能超过 32 个字符");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/user/name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message ?? "更新失败，请稍后重试");
      }

      setDisplayName(nextName);
      setEditing(false);
      onNameUpdated?.(nextName);
      // 同步 next-auth 会话，确保 cookie/session.name 立即更新
      updateSession?.({ name: nextName });
      message.success("用户名已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }, [inputValue, onNameUpdated]);

  if (editing) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Input
          size="sm"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="请输入用户名"
          className="w-44"
        />
        <Button
          type="primary"
          size="md"
          loading={saving}
          onClick={handleSave}
          className="px-3"
        >
          确定
        </Button>
        <Button size="md" onClick={handleCancel} disabled={saving} className="px-3">
          取消
        </Button>
      </div>
    );
  }

  return (
    <div className="username-container flex items-center justify-center gap-2 text-white">
      <span id="user-name-display" className="username-text text-lg font-semibold">
        {displayName}
      </span>
      <button
        type="button"
        className="edit-name-btn text-sm text-slate-400 cursor-pointer hover:text-slate-500"
        aria-label="编辑用户名"
        onClick={handleStartEdit}
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}
