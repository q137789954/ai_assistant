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
import { useAnimationPlayerActions } from "@/app/providers/AnimationProvider";
import BreakMeter, {
  type BreakMeterHandle,
} from "./page/components/BreakMeter";
import DefeatOverlay from "./page/components/DefeatOverlay";
import RoastBattleTotal from "./page/components/RoastBattleTotal";
import CounterRoastCards from "./page/components/CounterRoastCards";
import type { PenguinCounterCard } from "./page/components/CounterRoastCards";
import SubscriptionRequiredDialog from "./page/components/SubscriptionRequiredDialog";
import { createUUID } from "@/utils/uuid";

export default function Home() {
  const globals = useContext(GlobalsContext);
  const { chatbotVisible, dispatch } = globals ?? {};
  const { dispatch: roastBattleDispatch } =
    useContext(RoastBattleContext) || {};
  // 只订阅动作，避免动画状态更新触发页面整体重渲染
  const { switchToAnimationById, switchToRandomAnimationByType } =
    useAnimationPlayerActions();
  const { emitEvent, subscribe, status } = useWebSocketContext();
  const [retorts, setRetorts] = useState<PenguinCounterCard[]>([]);
  const [retortsGroupId, setRetortsGroupId] = useState<string>(() =>
    createUUID()
  );
  // 暂存 chat-response-meta 与“语音播放完成”的对应关系，确保两者都到齐后再更新卡片
  const pendingPenguinCounterRef = useRef(
    new Map<string, { retortOptions?: string[]; playbackComplete: boolean }>()
  );

  const requestId = useRef<string>(null);
  const speechStartTimestamp = useRef<number>(null);
  const breakMeterRef = useRef<BreakMeterHandle | null>(null);
  // 复用解码用的 AudioContext，避免重复创建带来的开销
  const entryDecodeContextRef = useRef<AudioContext | null>(null);
  // 击败弹窗显隐状态，用于在破防条满值时展示全屏提示
  const [defeatOpen, setDefeatOpen] = useState(false);
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);
  const [subscriptionLimitInfo, setSubscriptionLimitInfo] = useState({
    limit: 20,
    used: 0,
    remaining: 20,
  });
  const [subscriptionBlocked, setSubscriptionBlocked] = useState(false);
  // 统一根据回合快照刷新破防条进度，避免事件处理逻辑分散
  const syncBreakMeterFromRound = useCallback(
    (payload?: Record<string, unknown>) => {
      // 兼容后端返回的 round 为空/字符串的情况，保证前端解析安全
      const round =
        (payload?.round as { score?: number | string } | null) ?? null;
      const scoreRaw = round?.score;
      const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
      if (!Number.isFinite(score)) {
        return;
      }
      breakMeterRef.current?.set(score);
    },
    []
  );

  // 更新当前回合吐槽次数，供全局展示或其他组件复用
  const updateRoundRoastCount = useCallback(
    (roundRoastCount: number) => {
      if (!roastBattleDispatch) {
        return;
      }
      roastBattleDispatch({
        type: "SET_ROAST_BATTLE_ROUND_ROAST_COUNT",
        payload: { roundRoastCount },
      });
    },
    [roastBattleDispatch]
  );

  // 收到新回复时自增回合吐槽次数，保持与服务端进度一致
  const incrementRoundRoastCount = useCallback(() => {
    if (!roastBattleDispatch) {
      return;
    }
    roastBattleDispatch({
      type: "INCREMENT_ROAST_BATTLE_ROUND_ROAST_COUNT",
    });
  }, [roastBattleDispatch]);

  // 用于更新吐槽对战反击提示卡片，最多展示两条
  const updatePenguinCounter = useCallback((items: string[]) => {
    const cards: PenguinCounterCard[] = items.slice(0, 3).map((text) => ({
      id: createUUID(),
      title: text,
    }));

    setRetorts(cards);
    // 每次更新一组都换 groupId，确保触发整组出入场
    setRetortsGroupId(createUUID());
  }, []);

  // 同步检查某个 requestId 是否已满足“语音播放完成 + 元信息到达”的条件
  const tryTriggerPenguinCounter = useCallback(
    (requestId: string) => {
      const record = pendingPenguinCounterRef.current.get(requestId);
      if (!record) {
        return;
      }
      // retortOptions 允许为空数组，因此需要显式判断是否已写入
      if (!record.playbackComplete || record.retortOptions === undefined) {
        return;
      }
      updatePenguinCounter(record.retortOptions);
      // 已触发后清理，避免重复更新
      pendingPenguinCounterRef.current.delete(requestId);
    },
    [updatePenguinCounter]
  );

  const { stopTtsPlayback } = useTtsAudioPlayer({
    onRequestPlaybackComplete: (completedRequestId) => {
      // 使用播放完成信号替代 tts-audio-complete，避免音频未播完就触发卡片更新
      const record = pendingPenguinCounterRef.current.get(
        completedRequestId
      ) ?? {
        playbackComplete: false,
      };
      record.playbackComplete = true;
      pendingPenguinCounterRef.current.set(completedRequestId, record);
      tryTriggerPenguinCounter(completedRequestId);
    },
  });

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
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { winCount?: number; minRoastCount?: number | null };
      } | null;

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
      // switchToRandomAnimationByType("listen");
    }
  }, [dispatch, stopTtsPlayback]);

  /**
   * 每次收到 VAD 语音段后通过 socket.io 的自定义事件把音频帧上报给服务端
   */
  const handleVoiceChunk = useCallback(
    (audio: Float32Array) => {
      if (subscriptionBlocked) {
        return;
      }
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
    [emitEvent, ensureSpeechSession, subscriptionBlocked]
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
        case "subscription-required": {
          const payload = parsed.data ?? {};
          const limit = Number(payload.limit ?? 20);
          const used = Number(payload.used ?? limit);
          const remaining = Number(payload.remaining ?? 0);
          setSubscriptionLimitInfo({
            limit: Number.isFinite(limit) ? limit : 20,
            used: Number.isFinite(used) ? used : limit,
            remaining: Number.isFinite(remaining) ? remaining : 0,
          });
          setSubscriptionBlocked(true);
          setSubscriptionDialogOpen(true);
          stopTtsPlayback();
          break;
        }
        case "roast-battle-rounds": {
          // 初始化时同步当前吐槽对战回合分数，确保破防条从真实进度开始
          const payload = (parsed.data ?? {}) as Record<string, unknown>;
          console.log("roast-battle-rounds payload:", payload);
          const roundSnapshot =
            (payload.round as { roastCount?: number } | null) ?? null;
          if (!roundSnapshot) {
            // 服务端返回空回合时重置 UI，避免沿用上一轮的破防值/吐槽次数
            breakMeterRef.current?.reset();
            updateRoundRoastCount(0);
            setDefeatOpen(false);
            break;
          }
          syncBreakMeterFromRound(payload);
          // 从服务端回合快照同步吐槽次数，确保刷新页面后进度准确
          const { roastCount } = roundSnapshot;
          updateRoundRoastCount(
            typeof roastCount === "number" ? roastCount : 0
          );
          break;
        }
        case "roast-battle-rounds:ready": {
          // 继续对战后收到“准备完毕”事件，刷新破防条并关闭击败弹窗
          const payload = (parsed.data ?? {}) as Record<string, unknown>;
          syncBreakMeterFromRound(payload);
          setDefeatOpen(false);
          // 新回合开始时重置吐槽次数
          updateRoundRoastCount(0);
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
          const retortOptions = Array.isArray(payload.retort_options)
            ? (payload.retort_options as string[])
            : [];
          const metaRequestId =
            typeof payload.requestId === "string" ? payload.requestId : "";
          if (!metaRequestId) {
            console.warn(
              "chat-response-meta 缺少 requestId，已跳过反击卡片更新"
            );
            break;
          }
          // 先缓存元信息，再等待对应 requestId 的“播放完成”信号到达
          const record = pendingPenguinCounterRef.current.get(
            metaRequestId
          ) ?? {
            playbackComplete: false,
          };
          record.retortOptions = retortOptions;
          pendingPenguinCounterRef.current.set(metaRequestId, record);
          tryTriggerPenguinCounter(metaRequestId);
          incrementRoundRoastCount();
          break;
        }
        case "roast-battle-victory": {
          updatePenguinCounter([]);
          // 重置语音播放与动画帧
          stopTtsPlayback();
          // resetToFirstFrame();
          switchToAnimationById("quit");
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
    tryTriggerPenguinCounter,
    updateRoundRoastCount,
    incrementRoundRoastCount,
  ]);

  useEffect(() => {
    // 等待 WebSocket 连接成功后再主动请求当前吐槽对战回合数据，避免连接未就绪导致发送失败
    if (status !== "open") {
      return;
    }
    const sent = emitEvent("roast-battle-rounds:load");
    if (!sent) {
      console.warn("吐槽对战回合加载事件发送失败，请检查 WebSocket 连接状态");
    }
  }, [emitEvent, status]);

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
    if (subscriptionBlocked) {
      requestId.current = null;
      speechStartTimestamp.current = null;
      updatePenguinCounter([]);
      return;
    }
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
    updatePenguinCounter([]);
  }, [emitEvent, subscriptionBlocked, updatePenguinCounter]);

  // 继续对战按钮点击后通知服务端准备新一轮回合
  const handleDefeatContinue = useCallback(() => {
    switchToRandomAnimationByType("idle");
    const sent = emitEvent("roast-battle-rounds:continue");
    if (!sent) {
      console.warn("继续对战事件发送失败，请检查 WebSocket 连接状态");
    }
  }, [emitEvent, switchToRandomAnimationByType]);

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
          <BreakMeter ref={breakMeterRef} autoReset={false} initialValue={0} />
          <div className="mt-2">
            <RoastBattleTotal />
          </div>
        </div>
        {/* 动画组件区域：占位在页面中央，展示 Spine 动画渲染区域 */}
        <AnimationPlayer />
      </div>
      <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 w-full max-w-md px-4 z-20 overflow-hidden">
        <CounterRoastCards items={retorts} groupId={retortsGroupId} updatePenguinCounter={updatePenguinCounter} />
      </div>
      <div className="py-4 px-6 shrink-0">
        <div className="w-full flex gap-2 items-center">
          <div
            className="h-6 w-6 flex justify-center items-center text-xl"
            onClick={handleTextBtn}
          >
            💬
          </div>
          <AvatarCommandInput
            updatePenguinCounter={updatePenguinCounter}
            disabled={subscriptionBlocked}
          />
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
      <SubscriptionRequiredDialog
        open={subscriptionDialogOpen}
        limit={subscriptionLimitInfo.limit}
        used={subscriptionLimitInfo.used}
        remaining={subscriptionLimitInfo.remaining}
        onSubscribed={() => {
          setSubscriptionBlocked(false);
          setSubscriptionDialogOpen(false);
        }}
      />
      <DefeatOverlay open={defeatOpen} onContinue={handleDefeatContinue} />
      {/* <div className="bg-amber-500 absolute top-5 left-5 z-50" onClick={() => setDefeatOpen(true)}>点击</div> */}
    </main>
  );
}
