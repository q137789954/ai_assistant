import { useContext } from "react";

import { GlobalsContext } from "@/app/providers/GlobalsProviders";

const RoastBattleTotal = () => {
  // 从全局上下文中读取吐槽对战统计数据，避免重复请求
  const globals = useContext(GlobalsContext);
  const winCount = globals?.roastBattleWinCount ?? 0;
  const minRoastCount = globals?.roastBattleMinRoastCount ?? null;

  // 胜利场次的最小 roast_count 为空时，统一展示为 "-"
  const minRoastCountLabel = minRoastCount === null ? "-" : `${minRoastCount}`;

  return (
    <div className="flex gap-3 text-xs text-white/70 font-black italic">
      <div>Wins: {winCount}</div>
      <div>Fastest win: {minRoastCountLabel} rounds</div>
    </div>
  );
}

export default RoastBattleTotal;
