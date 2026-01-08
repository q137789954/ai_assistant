import { useContext } from "react";

import { RoastBattleContext } from "@/app/providers/RoastBattleProviders";

const RoastBattleTotal = () => {
  // 从全局上下文中读取吐槽对战统计数据，避免重复请求
  const roastBattleData = useContext(RoastBattleContext);
  const winCount = roastBattleData?.winCount ?? 0;
  const minRoastCount = roastBattleData?.minRoastCount ?? null;

  // 胜利场次的最小 roast_count 为空时，统一展示为 "-"
  const minRoastCountLabel = minRoastCount === null ? "-" : `${minRoastCount}`;

  return (
    <div className="flex gap-3 text-white/70 justify-between">
      <div className="px-2.5 py-0.5 bg-surface-2 rounded-full font-bold text-xs flex items-center gap-1">WINS: <span className="text-primary text-[14px] font-black">{winCount}</span></div>
      <div className="px-2.5 py-0.5 bg-surface-2 rounded-full font-bold text-xs flex items-center gap-1">Round: <span className="text-primary text-[14px] font-black">{minRoastCountLabel}</span></div>
    </div>
  );
}

export default RoastBattleTotal;
