"use client";

import PersonalCenterDrawer from "./PersonalCenterDrawer";
import LeaderboardBtn from "@/app/page/components/LeaderboardBtn";

const Tabbar = () => {
  return (
    <div className="flex items-center justify-end gap-3 flex-col md:flex-row-reverse md:justify-between">
      <LeaderboardBtn />
      {/* 个人中心入口与抽屉由组件内部统一管理 */}
      <PersonalCenterDrawer />
    </div>
  );
};

export default Tabbar;
