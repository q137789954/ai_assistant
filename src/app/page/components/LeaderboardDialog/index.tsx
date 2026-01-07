"use client";

import * as React from "react";
import clsx from "clsx";
// ✅ 把这里替换成你项目里 Dialog 的真实路径
import { Dialog } from "@/app/components/ui";

export type LeaderboardEntry = {
  rank: number;
  name: string;
  wins: number;
};

export type MyRank = {
  rankText: string; // e.g. "100+"
  name: string; // e.g. "You (Player)"
  winsText: string; // e.g. "12 Wins"
  emoji?: string; // e.g. "🔥"
};

export type LeaderboardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  title?: string; // e.g. "Global Top 100"
  entries?: LeaderboardEntry[];
  loading?: boolean;

  myRank?: MyRank;
  width?: number;
  displayName?: string;
};

const DEFAULT_ME: MyRank = {
  rankText: "100+",
  name: "You (Player)",
  winsText: "12 Wins",
  emoji: "🔥",
};

function rankNumClass(rank: number) {
  // 对齐原型：前三名金/银/铜高亮
  if (rank === 1)
    return "text-[#FFD700] drop-shadow-[0_0_6px_rgba(255,215,0,0.35)] text-[1.1rem]";
  if (rank === 2) return "text-[#C0C0C0]";
  if (rank === 3) return "text-[#CD7F32]";
  return "text-[#666]";
}

export function LeaderboardDialog({
  open,
  onOpenChange,
  title = "Global Top 100",
  entries,
  loading = false,
  myRank = DEFAULT_ME,
  width = 420,
}: LeaderboardDialogProps) {
  const showLoading = loading || !entries;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={width}
      closable={false}
      maskClosable
      centered
      // antd v5: 使用 styles 配置弹窗内容区样式，避免 bodyStyle 的弃用警告
      styles={{ body: { padding: 0 } }}
      className="!p-0"
    >
      {/* 外壳（对齐原型：panel、圆角、描边、溢出裁切） */}
      <div className="relative overflow-hidden rounded-[20px] border border-[#333] bg-[#1a1a1a] text-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="text-[1.05rem] font-black italic uppercase tracking-wide">
            {title}
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="text-[22px] leading-none text-[#666] transition hover:text-white active:scale-95 cursor-pointer"
          >
            ×
          </button>
        </div>

        {/* Body + Sticky footer wrapper */}
        <div className="relative max-h-[80vh]">
          {/* Scroll area（预留底部固定条空间，避免遮住列表） */}
          <div className="max-h-[80vh] overflow-y-auto px-5 py-4 pb-[92px] [-webkit-overflow-scrolling:touch]">
            <div className="flex flex-col">
              {showLoading ? (
                <div className="py-10 text-center text-sm text-[#666]">
                  Loading Ranks...
                </div>
              ) : entries.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#666]">
                  No ranks yet.
                </div>
              ) : (
                entries.map((it) => {
                  const isTop3 = it.rank <= 3;
                  return (
                    <div
                      key={it.rank}
                      className="flex items-center border-b border-white/5 py-3 gap-2"
                    >
                      <div
                        className={clsx(
                          "min-w-8 shrink-0 text-center",
                          rankNumClass(it.rank)
                        )}
                      >
                         {isTop3 ? <div className="text-xl">👑</div> : <span className="font-black italic text-base">{it.rank}</span>}
                      </div>

                      <div className="min-w-0 flex-1 flex gap-4 items-center justify-between">
                        <div className="truncate text-[0.92rem] font-semibold text-white">
                          {it.name}
                        </div>
                        <div className="text-[0.78rem] font-bold text-[#CCFF00]">
                          {it.wins} Wins
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Sticky footer：我的排名（对齐原型 sticky-user-rank） */}
          <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 border-t border-[#CCFF00] bg-[#222] px-5 py-4 shadow-[0_-10px_30px_rgba(0,0,0,0.65)]">
            <div className="w-10 shrink-0 text-center font-black italic text-[#666]">
              {myRank.rankText}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.92rem] font-semibold text-[#CCFF00]">
                {myRank.name}
              </div>
              <div className="text-[0.78rem] font-bold text-[#CCFF00]">
                {myRank.winsText}
              </div>
            </div>

            <div className="text-[1.35rem]">{myRank.emoji ?? "🔥"}</div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
