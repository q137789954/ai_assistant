"use client";

import PersonalCenterDrawer from "./PersonalCenterDrawer";
import LeaderboardBtn from "@/app/page/components/LeaderboardBtn";
import SubscriptionStatusBadge from "./SubscriptionStatusBadge";

const Tabbar = () => {
  return (
    <div className="flex items-center justify-end gap-3 flex-col md:flex-row md:justify-between">
      {/* 订阅状态集中展示，便于用户随时了解权益 */}
      <SubscriptionStatusBadge />
     <div className="flex gap-3 flex-col md:flex-row">
       <LeaderboardBtn />
      {/* 个人中心入口与抽屉由组件内部统一管理 */}
      <PersonalCenterDrawer />
     </div>
    </div>
  );
};

export default Tabbar;
