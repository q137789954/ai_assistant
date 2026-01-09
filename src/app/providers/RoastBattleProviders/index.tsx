'use client'

import React, { createContext, useMemo, useReducer } from 'react'
import type { RoastBattleAction, RoastBattleContextValue, RoastBattleState } from './types'

// 创建吐槽对战 Context，默认值为 undefined 以便识别未包裹的场景
export const RoastBattleContext = createContext<RoastBattleContextValue | undefined>(undefined)

// 初始化吐槽对战状态，确保首次渲染时字段稳定
const initialState: RoastBattleState = {
  winCount: 0,
  minRoastCount: null,
  roundRoastCount: 0,
}

// 吐槽对战的 reducer，集中处理胜场与最小吐槽数的更新逻辑
const reducer = (state: RoastBattleState, action: RoastBattleAction): RoastBattleState => {
  switch (action.type) {
    case 'SET_ROAST_BATTLE_STATS': {
      // 同值更新直接返回旧状态，避免不必要的 rerender
      if (
        state.winCount === action.payload.winCount &&
        state.minRoastCount === action.payload.minRoastCount
      ) {
        return state
      }
      return {
        ...state,
        winCount: action.payload.winCount,
        minRoastCount: action.payload.minRoastCount,
      }
    }
    case 'SET_ROAST_BATTLE_ROUND_ROAST_COUNT': {
      // 回合同步数据时仅在值变化后更新，减少状态抖动
      if (state.roundRoastCount === action.payload.roundRoastCount) {
        return state
      }
      return {
        ...state,
        roundRoastCount: action.payload.roundRoastCount,
      }
    }
    case 'INCREMENT_ROAST_BATTLE_ROUND_ROAST_COUNT': {
      // 每次新增一条吐槽时自增，避免外部重复计算
      return {
        ...state,
        roundRoastCount: state.roundRoastCount + 1,
      }
    }
    case 'RESET_ROAST_BATTLE_STATS': {
      // 已经是默认值时直接返回，减少状态抖动
      if (
        state.winCount === initialState.winCount &&
        state.minRoastCount === initialState.minRoastCount &&
        state.roundRoastCount === initialState.roundRoastCount
      ) {
        return state
      }
      return initialState
    }
    default:
      return state
  }
}

export default function RoastBattleProviders({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const { winCount, minRoastCount, roundRoastCount } = state

  // 通过 useMemo 固定 Context value，避免下游组件无谓刷新
  const value: RoastBattleContextValue = useMemo(
    () => ({
      winCount,
      minRoastCount,
      roundRoastCount,
      dispatch,
    }),
    [winCount, minRoastCount, roundRoastCount, dispatch]
  )

  return <RoastBattleContext.Provider value={value}>{children}</RoastBattleContext.Provider>
}
