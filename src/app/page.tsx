"use client";

import { useCallback, useContext, useEffect, useState, useRef } from "react";
import Chatbot from "./page/components/Chatbot";
import AvatarCommandInput from "./page/AvatarCommandInput";
import AnimationPlayer from "./page/components/AnimationPlayer";
import { useVoiceInputListener, useTtsAudioPlayer } from "./hooks";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { RoastBattleContext } from "@/app/providers/RoastBattleProviders";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import Tabbar from "./page/components/Tabbar";
import {
  useAnimationPlayerActions,
} from "@/app/providers/AnimationProvider";
import BreakMeter, {
  type BreakMeterHandle,
} from "./page/components/BreakMeter";
import DefeatOverlay from "./page/components/DefeatOverlay";
import RoastBattleTotal from "./page/components/RoastBattleTotal";
import CounterRoastCards from "./page/components/CounterRoastCards";
import type { PenguinCounterCard } from "./page/components/CounterRoastCards";

export default function Home() {
  const globals = useContext(GlobalsContext);
  const { chatbotVisible, dispatch } = globals ?? {};
  const { dispatch: roastBattleDispatch } = useContext(RoastBattleContext) || {};
  console.log(11111);
  // 只订阅动作，避免动画状态更新触发页面整体重渲染
  const { switchToAnimationById } = useAnimationPlayerActions();
  const { stopTtsPlayback } = useTtsAudioPlayer();
  const { emitEvent, subscribe } = useWebSocketContext();
  const [retorts, setRetorts] = useState<PenguinCounterCard[]>([]);
  const [retortsGroupId, setRetortsGroupId] = useState<string>(() => crypto.randomUUID());

  const requestId = useRef<string>(null);
  const speechStartTimestamp = useRef<number>(null);
  const breakMeterRef = useRef<BreakMeterHandle | null>(null);
  // 复用解码用的 AudioContext，避免重复创建带来的开销
  const entryDecodeContextRef = useRef<AudioContext | null>(null);
  // 击败弹窗显隐状态，用于在破防条满值时展示全屏提示
  const [defeatOpen, setDefeatOpen] = useState(false);
  // 统一根据回合快照刷新破防条进度，避免事件处理逻辑分散
  const syncBreakMeterFromRound = useCallback((payload?: Record<string, unknown>) => {
    // 兼容后端返回的 round 为空/字符串的情况，保证前端解析安全
    const round = (payload?.round as { score?: number | string } | null) ?? null;
    const scoreRaw = round?.score;
    const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
    if (!Number.isFinite(score)) {
      return;
    }
    breakMeterRef.current?.set(score);
  }, []);

// 用于更新吐槽对战，反击提示卡片
  const updatePenguinCounter = (items:string[]) => {
    const cards: PenguinCounterCard[] = items.slice(0, 2).map((text) => ({
      id: crypto.randomUUID(),
      title: text,
    }));

    setRetorts(cards);
    setRetortsGroupId(crypto.randomUUID()); // ✅ 每次更新一组都换 groupId，确保触发整组出入场
  };

  /**
   * 拉取吐槽对战统计并写入 GlobalsContext
   * - 初始化页面和胜利事件后都需要刷新
   * - 接口返回失败时仅记录日志，避免影响主流程
   */
  const refreshRoastBattleStats = useCallback(async () => {
    console.log("刷新吐槽对战统计数据...");
    if (!roastBattleDispatch) {
      return;
    }
    console.log("开始请求吐槽对战统计接口...");

    try {
      const response = await fetch("/api/roast-battle/stats");
      if (!response.ok) {
        console.warn("吐槽对战统计接口返回非 2xx:", response.status);
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            data?: { winCount?: number; minRoastCount?: number | null };
          }
        | null;

      if (!payload?.success || !payload.data) {
        console.warn("吐槽对战统计接口返回异常数据:", payload);
        return;
      }

      console.log(payload.data.winCount, payload.data.minRoastCount);

      roastBattleDispatch({
        type: "SET_ROAST_BATTLE_STATS",
        payload: {
          winCount: payload.data.winCount ?? 0,
          minRoastCount:
            typeof payload.data.minRoastCount === "number"
              ? payload.data.minRoastCount
              : null,
        },
      });
    } catch (error) {
      console.warn("拉取吐槽对战统计失败:", error);
    }
  }, [roastBattleDispatch]);

  const ensureSpeechSession = useCallback(() => {
    if (!requestId.current) {
      requestId.current = `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      speechStartTimestamp.current = Date.now();
      dispatch?.({
        type: "SET_TIMESTAMP_WATERMARK",
        payload: speechStartTimestamp.current,
      });
      // 发送新指令前重置语音播放与动画帧
      stopTtsPlayback();
      // resetToFirstFrame();
      switchToAnimationById("listen1");
    }
  }, [dispatch, stopTtsPlayback, switchToAnimationById]);

  /**
   * 每次收到 VAD 语音段后通过 socket.io 的自定义事件把音频帧上报给服务端
   */
  const handleVoiceChunk = useCallback(
    (audio: Float32Array) => {
      ensureSpeechSession();
      const chunkMeta = {
        requestId: requestId.current,
        chunkId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sampleRate: 16000,
        timestamp: Date.now(),
        content: Array.from(audio),
        outputFormat: "speech",
        inputFormat: "speech",
      };
      const sent = emitEvent("chat:input", chunkMeta, audio);
      if (!sent) {
        console.warn("语音帧发送失败，请检查 WebSocket 连接状态");
      }
    },
    [emitEvent, ensureSpeechSession]
  );

  useEffect(() => {
    // 监听 WebSocket 元信息事件，将服务端结算的破防增量映射到 BreakMeter
    const unsubscribe = subscribe((event) => {
      if (typeof event.data !== "string") {
        return;
      }

      let parsed: { event?: string; data?: Record<string, unknown> } | null =
        null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!parsed) {
        return;
      }

      const eventType = parsed.event;

      switch (eventType) {
        case "roast-battle-rounds": {
          // 初始化时同步当前吐槽对战回合分数，确保破防条从真实进度开始
          const payload = (parsed.data ?? {}) as Record<string, unknown>;
          console.log("roast-battle-rounds payload:", payload);
          syncBreakMeterFromRound(payload);
          break;
        }
        case "roast-battle-rounds:ready": {
          // 继续对战后收到“准备完毕”事件，刷新破防条并关闭击败弹窗
          const payload = (parsed.data ?? {}) as Record<string, unknown>;
          syncBreakMeterFromRound(payload);
          setDefeatOpen(false);
          break;
        }
        case "chat-response-meta": {
          // 处理见下方专门逻辑
          // damage_delta 可能来自字符串或数字，统一转成数字后再更新破防条
          const payload = parsed.data ?? {};
          console.log("chat-response-meta payload:", payload);
          const damageDeltaRaw = payload.damage_delta;
          const damageDelta =
            typeof damageDeltaRaw === "number"
              ? damageDeltaRaw
              : Number(damageDeltaRaw);
          if (Number.isFinite(damageDelta)) {
            breakMeterRef.current?.addRage(damageDelta);
          }
          const retort_options = payload.retort_options as string[] || [];
          updatePenguinCounter(retort_options)
          break;
        }
        case "roast-battle-victory": {
          updatePenguinCounter([]);
          // 重置语音播放与动画帧
          stopTtsPlayback();
          // resetToFirstFrame();
          switchToAnimationById("idle1");
          // 收到胜利事件,进度条直接满
          breakMeterRef.current?.set(100);
          // 弹出击败提示，同时可以在这里补充其他收尾逻辑
          setDefeatOpen(true);
          // 胜利后刷新统计，确保胜场数及时同步
          void refreshRoastBattleStats();
          break;
        }
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    refreshRoastBattleStats,
    stopTtsPlayback,
    subscribe,
    switchToAnimationById,
    syncBreakMeterFromRound,
  ]);

  // 页面初始化时拉取吐槽对战统计，提供给全局展示组件
  useEffect(() => {
    void refreshRoastBattleStats();
  }, [refreshRoastBattleStats]);

  useEffect(() => {
    return () => {
      entryDecodeContextRef.current?.close().catch(() => {});
      entryDecodeContextRef.current = null;
    };
  }, []);

  const onSpeechEnd = useCallback(() => {
    emitEvent("chat:input", {
      content: [],
      outputFormat: "speech",
      inputFormat: "speech",
      type: "end",
      timestamp: Date.now(),
      requestId: requestId.current,
    });
    requestId.current = null;
    speechStartTimestamp.current = null;
  }, [emitEvent]);

  // 继续对战按钮点击后通知服务端准备新一轮回合
  const handleDefeatContinue = useCallback(() => {
    const sent = emitEvent("roast-battle-rounds:continue");
    if (!sent) {
      console.warn("继续对战事件发送失败，请检查 WebSocket 连接状态");
    }
  }, [emitEvent]);

  useVoiceInputListener({
    onSpeechSegment: handleVoiceChunk,
    onSpeechEnd,
    onError(error) {
      console.error("VAD 错误：", error);
    },
    vadOptions: {
      // 例如调整开始/结束阈值：
      // positiveSpeechThreshold: 0.7,
      // negativeSpeechThreshold: 0.3,
    },
  });

  const handleTextBtn = useCallback(() => {
    if (dispatch) {
      dispatch({ type: "SET_CHATBOT_VISIBILITY", payload: !chatbotVisible });
    }
  }, [chatbotVisible, dispatch]);

  // 所有动画资源加载完之前展示一个加载中组件（最多10秒）

  return (
    <main className="h-full w-full relative flex flex-col bg-[url('/home/lamplight.jpeg')] bg-cover bg-center bg-no-repeat">
      {/* 移动端让 Tabbar 悬浮在页面右侧，桌面端保持原有布局 */}
      <div className="fixed right-3 top-30 z-30 md:static md:py-4 md:px-6 md:shrink-0">
        <Tabbar />
      </div>
      <div className="flex flex-1 justify-center items-center grow shrink max-h-[calc(100%-68px)] md:max-h-[calc(100%-132px)] relative">
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 w-11/12 max-w-md z-10">
          <BreakMeter
          ref={breakMeterRef}
          autoReset={false}
          initialValue={0}
        />
          <div className="mt-2">
            <RoastBattleTotal />
          </div>
        </div>
        {/* 动画组件区域：占位在页面中央，展示 Spine 动画渲染区域 */}
        <AnimationPlayer />
      </div>
      <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 w-full max-w-md px-4 z-20 overflow-hidden">
        <CounterRoastCards items={retorts} groupId={retortsGroupId} />
      </div>
      <div className="py-4 px-6 shrink-0">
        <div className="w-full flex gap-2 items-center">
          <div
            className="h-6 w-6 flex justify-center items-center text-xl"
            onClick={handleTextBtn}
          >
            💬
          </div>
          <AvatarCommandInput />
        </div>
      </div>
      {/* Chatbot 通过抽屉形式展示，交由 open 状态控制动画 */}
      <Chatbot
        open={chatbotVisible || false}
        onOpenChange={(next) => {
          if (dispatch) {
            dispatch({ type: "SET_CHATBOT_VISIBILITY", payload: next });
          }
        }}
      />
      <DefeatOverlay
        open={defeatOpen}
        onContinue={handleDefeatContinue}
      />
    </main>
  );
}
