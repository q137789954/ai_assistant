'use client'

import * as React from 'react'
import { LeaderboardDialog, type LeaderboardEntry, type MyRank } from '../LeaderboardDialog'
import { useSession } from "next-auth/react";

type LeaderboardApiEntry = {
  userId: string;
  name: string | null;
  winCount: number;
};

type LeaderboardApiResponse = {
  success: boolean;
  data?: {
    entries: LeaderboardApiEntry[];
    my: {
      userId: string;
      name: string | null;
      winCount: number;
      rank: number | null;
    };
  };
};

export default function LeaderboardBtn() {
  const [open, setOpen] = React.useState(false)
  const { data: session } = useSession();
  const [entries, setEntries] = React.useState<LeaderboardEntry[] | null>(null);
  const [myRank, setMyRank] = React.useState<MyRank | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);

  const sessionName = session?.user?.name ?? "";

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    const loadLeaderboard = async () => {
      setLoading(true);
      try {
        // 打开排行榜时实时拉取最新数据，避免显示旧榜单
        const response = await fetch("/api/roast-battle/leaderboard", {
          method: "GET",
          signal: controller.signal,
        });
        const payload = (await response.json()) as LeaderboardApiResponse;
        if (!payload.success || !payload.data) {
          setEntries([]);
          setMyRank({
            rankText: "100+",
            name: sessionName || "You (Player)",
            winsText: "0 Wins",
            emoji: "🔥",
          });
          return;
        }

        // 将接口数据映射为弹窗可直接展示的条目结构
        const nextEntries = payload.data.entries.map((entry, index) => ({
          rank: index + 1,
          name: entry.name || `Player_${index + 1}`,
          wins: entry.winCount,
        }));

        // 构造当前用户的榜单信息，未上榜时显示 100+
        const myRankNumber = payload.data.my.rank;
        const myRankText =
          myRankNumber && myRankNumber <= 100 ? String(myRankNumber) : "100+";

        setEntries(nextEntries);
        setMyRank({
          rankText: myRankText,
          name: payload.data.my.name || sessionName || "You (Player)",
          winsText: `${payload.data.my.winCount} Wins`,
          emoji: "🔥",
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("LeaderboardBtn: 拉取排行榜失败", error);
        }
      } finally {
        setLoading(false);
      }
    };

    void loadLeaderboard();

    return () => {
      controller.abort();
    };
  }, [open, sessionName]);

  return (
    <>
      <div className='cursor-pointer text-2xl' onClick={() => setOpen(true)}>🏆</div>

      <LeaderboardDialog
        open={open}
        onOpenChange={setOpen}
        title="Global Top 100"
        entries={entries ?? undefined}
        loading={loading}
        myRank={myRank}
      />
    </>
  )
}
