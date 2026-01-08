import type { Dispatch } from 'react'

// 吐槽对战的基础状态，统一保存胜利次数与最小吐槽数
export type RoastBattleState = {
  // 胜利总次数，用于排行榜或战绩展示
  winCount: number
  // 胜利回合中最小的 roast_count，没有胜利时为 null
  minRoastCount: number | null
}

// 吐槽对战状态的动作定义，集中管理可变更的入口
export type RoastBattleAction =
  // 批量更新胜利次数与最小 roast 数
  | {
      type: 'SET_ROAST_BATTLE_STATS'
      payload: { winCount: number; minRoastCount: number | null }
    }
  // 重置吐槽对战统计为默认值
  | { type: 'RESET_ROAST_BATTLE_STATS' }

// Context 暴露的数据结构，包含状态与派发入口
export interface RoastBattleContextValue extends RoastBattleState {
  // 统一对外暴露 dispatch，便于在组件内控制状态流
  dispatch: Dispatch<RoastBattleAction>
}
