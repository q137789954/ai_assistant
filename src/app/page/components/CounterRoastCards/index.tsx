"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Variants } from "motion/react";

export type PenguinCounterCard = {
  id: string;
  title: string;
};

type Props = {
  items: PenguinCounterCard[];
  groupId?: string;
};

// 单卡动画时长（进入）
const ENTER_DUR = 0.28;
// 单卡动画时长（退出）
const EXIT_DUR = 0.22;
// ✅ 关键：stagger < ENTER_DUR，才能“前一个进入一部分后，下一个开始进入”
const STAGGER = 0.12;

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.7, 0, 0.84, 0] as const;

function makeGroupKey(items: PenguinCounterCard[], groupId?: string) {
  if (groupId) return groupId;
  return items.map((x) => x.id).join("|");
}

function CounterRoastCards({ items = [], groupId }: Props) {
  const safeItems = React.useMemo(() => items.slice(0, 3), [items]);
  const groupKey = React.useMemo(
    () => makeGroupKey(safeItems, groupId),
    [safeItems, groupId]
  );

  // 父容器：只负责“编排”（stagger）
  const groupVariants: Variants = {
    hidden: {},
    show: {
      transition: {
        delayChildren: 0.02,
        staggerChildren: STAGGER, // 进入依次开始
      },
    },
    exit: {
      transition: {
        staggerChildren: STAGGER, // 退出依次开始
        staggerDirection: -1, // 从最后一张开始退（想从第一张开始退就去掉这行）
      },
    },
  };

  // 子卡片：真正的位移动画（由父容器驱动到 hidden/show/exit）
  const cardVariants: Variants = {
    hidden: { x: -48, opacity: 0, scale: 0.98 },
    show: {
      x: 0,
      opacity: 1,
      scale: 1,
      transition: { duration: ENTER_DUR, ease: EASE_OUT },
    },
    exit: {
      x: 48,
      opacity: 0,
      scale: 0.98,
      transition: { duration: EXIT_DUR, ease: EASE_IN },
    },
  };

  return (
    <div className="relative w-full">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={groupKey}
          variants={groupVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          className="grid gap-3"
        >
          {safeItems.map((item) => (
            <motion.div
              key={item.id}
              variants={cardVariants}
              className="rounded-xl border border-white/10 bg-white/5 p-2 text-white"
            >
              <div className="text-[12px] font-semibold">{item.title}</div>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default CounterRoastCards;
