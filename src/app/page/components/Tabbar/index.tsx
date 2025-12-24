"use client";

import { useCallback, useContext, useRef, type TouchEvent } from "react";
import { useSession } from "next-auth/react";
import { Drawer } from "@/app/components/ui";
import { Typography } from "antd";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { Pencil, Copy, Check } from "lucide-react";

const { Paragraph } = Typography;

const Tabbar = () => {
  const { data: session } = useSession();
  const globals = useContext(GlobalsContext);

  const name = session?.user?.name ?? "";
  const uid = session?.user?.id ?? session?.user?.email ?? "8848123";
  const initial = (name?.[0] ?? "U").toUpperCase();

  // 利用 Context 统一控制抽屉显示/隐藏，便于后续多处复用
  const { personalCenterVisible = false, dispatch } = globals ?? {};
  const handleOpenPersonalCenter = useCallback(() => {
    dispatch?.({ type: "SET_PERSONAL_CENTER_VISIBILITY", payload: true });
  }, [dispatch]);
  const handleClosePersonalCenter = useCallback(() => {
    dispatch?.({ type: "SET_PERSONAL_CENTER_VISIBILITY", payload: false });
  }, [dispatch]);

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

  const menuItems = [
    { label: "🔒 Change Password" },
    { label: "🛡️ Privacy Policy" },
  ];

  // 这些菜单项仅负责展示，后续可根据具体需求绑定 Webview 或导航

  return (
    <>
      <div className="flex justify-between p-4">
        <button
          type="button"
          onClick={handleOpenPersonalCenter}
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[rgb(204,255,0)] text-lg font-bold text-[rgb(204,255,0)]! shadow-sm cursor-pointer transition hover:opacity-85"
          aria-label="打开个人中心"
        >
          {initial}
        </button>
      </div>

      {/* 个人中心抽屉：承载用户信息、菜单与退出操作 */}
      <Drawer
        open={personalCenterVisible}
        onClose={handleClosePersonalCenter}
        placement="left"
        width={360}
        className="personal-center-drawer"
      >
        <div
          className="flex h-full w-full flex-col gap-6 bg-[rgb(26,26,26)] px-6 py-6 shadow-2xl text-slate-100"
          onTouchStart={handleDrawerTouchStart}
          onTouchEnd={handleDrawerTouchEnd}
          onTouchCancel={handleDrawerTouchCancel}
        >
          <div className="drawer-content flex flex-col gap-5">
            <div className="user-header flex flex-col gap-3 border-b border-slate-100 pb-4">
              <div className="big-avatar-wrapper relative mx-auto flex h-20 w-20 items-center justify-center">
                <span className="flex items-center justify-center border-4 w-20 h-20 rounded-full border-[rgb(204,255,0)] text-3xl font-bold text-[rgb(204,255,0)]!">
                  {initial}
                </span>
              </div>
              <div className="username-container flex items-center justify-center gap-2 text-white">
                <span
                  id="user-name-display"
                  className="username-text text-lg font-semibold"
                >
                  {name}
                </span>
                <span className="edit-name-btn text-sm text-slate-400 cursor-pointer hover:text-slate-500">
                  <Pencil size={12} />
                </span>
              </div>
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
              type="button"
              className="w-full rounded-2xl border border-slate-700 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:text-white"
            >
              LOG OUT
            </button>
            <div className="text-center text-xs font-medium text-slate-400">
              Delete Account
            </div>
          </div>
        </div>
      </Drawer>
    </>
  );
};

export default Tabbar;
