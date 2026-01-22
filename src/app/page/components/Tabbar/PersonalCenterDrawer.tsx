"use client";

import { useCallback, useContext, useEffect, useRef, useState, type TouchEvent } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/app/components/ui";
import { Typography } from "antd";
import { Copy, Check, Settings, X } from "lucide-react";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";

import ChangePasswordDialog from "./ChangePasswordDialog";
import UserNameEditor from "./UserNameEditor";

const { Paragraph } = Typography;

type PersonalCenterMenuItem = {
  // 菜单项展示文案（带表情或文字）
  label: string;
  // 菜单项点击回调（某些菜单仅展示不触发行为）
  onClick?: () => void;
};

// 个人中心抽屉组件的输入参数定义
const PersonalCenterDrawer = () => {
  // 会话信息用于展示昵称与 UID
  const { data: session } = useSession();
  // 通过全局上下文统一控制抽屉显示/隐藏
  const globals = useContext(GlobalsContext);
  const { personalCenterVisible = false, dispatch } = globals ?? {};
  const handleOpenPersonalCenter = useCallback(() => {
    dispatch?.({ type: "SET_PERSONAL_CENTER_VISIBILITY", payload: true });
  }, [dispatch]);
  const handleClosePersonalCenter = useCallback(() => {
    dispatch?.({ type: "SET_PERSONAL_CENTER_VISIBILITY", payload: false });
  }, [dispatch]);
  // 路由控制用于菜单点击跳转
  const router = useRouter();
  // 用户显示名称状态，便于编辑后立即更新
  const sessionName = session?.user?.name ?? "";
  const [displayName, setDisplayName] = useState(sessionName);
  useEffect(() => {
    setDisplayName(sessionName);
  }, [sessionName]);

  // 用户 UID 优先使用 id，其次回退到邮箱，最终提供占位值
  const uid = session?.user?.id ?? session?.user?.email ?? "8848123";
  // 头像首字母回退为 U，保持稳定展示
  const initial = (displayName?.[0] ?? "U").toUpperCase();

  // 修改密码弹窗受控状态
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  // 隐藏抽屉后再跳转，避免界面闪烁
  const handlePrivacyPolicy = useCallback(() => {
    handleClosePersonalCenter();
    router.push("/privacy");
  }, [handleClosePersonalCenter, router]);
  // 隐藏抽屉后再跳转到条款页
  const handleTerms = useCallback(() => {
    handleClosePersonalCenter();
    router.push("/terms");
  }, [handleClosePersonalCenter, router]);

  // 菜单项配置收敛在抽屉内部，避免 Tabbar 维护业务细节
  const menuItems: PersonalCenterMenuItem[] = [
    { label: "🔒 Change Password", onClick: () => setPasswordModalOpen(true) },
    { label: "🛡️ Privacy Policy", onClick: handlePrivacyPolicy },
    { label: "📄 Terms", onClick: handleTerms },
  ];

  // 退出登录统一处理跳转逻辑
  const handleSignOut = useCallback(() => {
    signOut({ callbackUrl: "/login" });
  }, []);
  // 左滑闭合抽屉：记录触点起始位置并基于阈值判断是否触发关闭动作
  const touchStartXRef = useRef<number | null>(null);
  const handleDrawerTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      touchStartXRef.current = event.touches[0]?.clientX ?? null;
    },
    []
  );
  const handleDrawerTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const startX = touchStartXRef.current;
      const endX = event.changedTouches[0]?.clientX;
      // 预防段差：起始点与结束点之间超过 40px 视为左滑
      if (startX !== null && endX !== undefined && startX - endX > 40) {
        handleClosePersonalCenter();
      }
      touchStartXRef.current = null;
    },
    [handleClosePersonalCenter]
  );
  const handleDrawerTouchCancel = useCallback(() => {
    touchStartXRef.current = null;
  }, []);

  return (
    <>
      {/* 个人中心入口按钮 */}
      <div
        className="cursor-pointer text-white hover:text-[#cf0]"
        onClick={handleOpenPersonalCenter}
      >
        <Settings size={24} />
      </div>
      <Drawer
        open={personalCenterVisible}
        onClose={handleClosePersonalCenter}
        placement="left"
        size={360}
        className="personal-center-drawer"
      >
        <div
          className="flex h-full w-full flex-col gap-6 bg-[rgb(26,26,26)] px-6 py-6 shadow-2xl text-slate-100"
          onTouchStart={handleDrawerTouchStart}
          onTouchEnd={handleDrawerTouchEnd}
          onTouchCancel={handleDrawerTouchCancel}
        >
          <div className="drawer-content flex flex-col gap-5">
            {/* 顶部操作区：提供一个显式的关闭按钮，方便用户一键收起抽屉 */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={handleClosePersonalCenter}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 text-slate-200 transition cursor-pointer hover:border-slate-400 hover:text-white"
                aria-label="关闭个人中心"
              >
                <X size={16} />
              </button>
            </div>
            <div className="user-header flex flex-col gap-3 border-b border-slate-100 pb-4">
              <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
                <span className="flex items-center justify-center border-4 w-20 h-20 rounded-full border-[rgb(204,255,0)] text-3xl font-bold text-[rgb(204,255,0)]!">
                  {initial}
                </span>
              </div>
              <UserNameEditor
                name={displayName}
                onNameUpdated={setDisplayName}
                isOpen={personalCenterVisible}
              />
              <Paragraph
                className="text-xs font-medium text-slate-400 flex items-center gap-1 justify-center"
                copyable={{
                  tooltips: false,
                  text: uid,
                  icon: [
                    <Copy
                      className="text-slate-400 hover:text-slate-500"
                      size={12}
                      key="copy-icon"
                    />,
                    <Check size={12} key="copied-icon" />,
                  ],
                }}
              >
                <div className="flex items-center gap-1 text-xs font-medium text-slate-400">
                  UID: {uid}
                </div>
              </Paragraph>
            </div>

            <div className="flex flex-col gap-2">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.onClick}
                  className="menu-item flex items-center justify-between rounded-2xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:bg-white/5"
                >
                  <span className="flex items-center gap-2">{item.label}</span>
                  <span className="text-slate-400">&gt;</span>
                </button>
              ))}
            </div>
          </div>

          {/* 退出相关入口保持在抽屉底部 */}
          <div className="logout-area mt-auto flex flex-col gap-2">
            <button
              onClick={handleSignOut}
              type="button"
              className="cursor-pointer w-full rounded-2xl border border-slate-700 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:text-white"
            >
              LOG OUT
            </button>
            <div className="text-center text-xs font-medium text-slate-400 cursor-pointer hover:text-slate-500">
              Delete Account
            </div>
          </div>
        </div>
      </Drawer>
      {/* 修改密码弹窗组件独立管理表单逻辑 */}
      <ChangePasswordDialog open={passwordModalOpen} onOpenChange={setPasswordModalOpen} />
    </>
  );
};

export default PersonalCenterDrawer;
