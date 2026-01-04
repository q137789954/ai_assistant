import { useCallback, useContext, useEffect, useRef } from "react";
import { useAnimationPlayer } from "@/app/providers/AnimationProvider";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";

/**
 * 用于跟踪每个 TTS 句子的状态，包含格式、Worklet 缓存与播放标识。
 */
type SentenceState = {
  // 记录当前句子的音频格式，例如 mp3、wav，用于决定是否走 Worklet 流程
  format: string;
  // 标记是否已经入列，避免重复处理
  enqueued?: boolean;
  // 标记服务端是否告知该句子已全部发送完毕
  isComplete?: boolean;
  // 指示当前格式是否支持透传到 Web Audio Worklet 进行自定义播放
  useWorklet?: boolean;
  // Worklet 等待推送的每次 PCM 通道数组
  workletBuffers?: Float32Array[][];
  // 缓冲区是否已经被 Worklet 消耗完，播放完成时会触发清理逻辑
  workletDrained?: boolean;
  // 记录第一块音频到达时的时间戳，用于统计延迟
  firstChunkTimestamp?: number;
  // 避免多次记录播放延迟
  hasLoggedPlayback?: boolean;
  // 当前句子所属的 requestId（可能包含多个句子），用于聚合播放完成时机
  requestId?: string;
};

/**
 * 本地直接播放语音时的可选参数。
 */
type PlaySpeechOptions = {
  // 指定音频格式，主要用于判断是否走 Worklet 通路
  format?: string;
  // 透传 requestId，便于和原有播放完成逻辑对齐（可选）
  requestId?: string;
};

const base64ToUint8Array = (base64: string) => {
  // 将服务端返回的 Base64 PCM 数据解码为字节数组，后续再转换为 Float32
  const binary = globalThis.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const buildFloat32ChannelFromPcm = (chunk: Uint8Array) => {
  const sampleCount = Math.floor(chunk.byteLength / Int16Array.BYTES_PER_ELEMENT);
  if (!sampleCount) {
    return null;
  }
  const view = new DataView(chunk.buffer, chunk.byteOffset, sampleCount * Int16Array.BYTES_PER_ELEMENT);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    // 将 16 位 PCM 采样值映射到 [-1,1] 之间的浮点数，对 outlier 做夹取处理
    float32[i] = Math.max(-1, Math.min(1, view.getInt16(i * 2, true) / 32768));
  }
  return float32;
};

// 统一过滤非字符串的数据，避免后续操作中因 undefined 或 null 引发异常
const safeString = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * 尝试将 WebSocket 收到的消息解析为 JSON，对非字符串或无法解析的 payload 返回 null。
 */
const describeEvent = (event: MessageEvent) => {
  const data = typeof event.data === "string" ? event.data : undefined;
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const logPlaybackLatency = (sentenceId: string, entry: SentenceState) => {
  if (entry.hasLoggedPlayback) {
    return;
  }
  entry.hasLoggedPlayback = true;
};

const supportsWorkletFormat = (format: string | undefined) => {
  const raw = (format ?? "mp3").trim().toLowerCase();
  // 只允许少数音频格式走 Worklet，避免浏览器解码失败
  return !!raw && /(?:audio\/)?(wav|pcm|raw|linear16|mp3|mpeg|ogg)/.test(raw);
};

// 将传入的音频数据统一转换为 Float32Array，方便直接推送到 Worklet。
const normalizeToFloat32 = (
  audio: Float32Array | Int16Array | Uint8Array | number[] | null | undefined,
) => {
  if (!audio) {
    return null;
  }
  if (audio instanceof Float32Array) {
    return audio.length ? audio : null;
  }
  if (audio instanceof Int16Array) {
    const output = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i += 1) {
      // 将 16 位有符号整数映射到 [-1, 1]
      output[i] = Math.max(-1, Math.min(1, audio[i] / 32768));
    }
    return output;
  }
  if (audio instanceof Uint8Array) {
    const output = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i += 1) {
      // 8 位无符号整数转为中心为 0 的浮点数
      output[i] = Math.max(-1, Math.min(1, (audio[i] - 128) / 128));
    }
    return output;
  }
  if (Array.isArray(audio)) {
    const output = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i += 1) {
      const value = Number(audio[i]);
      output[i] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }
    return output;
  }
  return null;
};

export const useTtsAudioPlayer = () => {
  const { subscribe } = useWebSocketContext();
  const { allAnimationsLoaded, animations, switchToAnimationById, play } = useAnimationPlayer();
  // 读取全局的 timestampWatermark，确保旧指令的 TTS 语音在新指令发出后不会继续执行
  const globalsContext = useContext(GlobalsContext);
  const timestampWatermark = globalsContext?.timestampWatermark ?? null;
  // 存放每个 sentenceId 对应的播放与缓存状态，跨事件保持持久性
  const sentencesRef = useRef(new Map<string, SentenceState>());
  // FIFO 队列用于串行播放多个 TTS 句子
  const queueRef = useRef<string[]>([]);
  // 标记当前是否已有 Worklet 正在播放
  const isPlayingRef = useRef(false);
  // 当前正在播放的 sentenceId（包括发送与 Worklet 的状态一致性判断）
  const currentSentenceIdRef = useRef<string | null>(null);
  // 音频上下文与 Worklet 节点相关引用
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletPortRef = useRef<MessagePort | null>(null);
  const workletReadyRef = useRef(false);
  const currentWorkletSentenceIdRef = useRef<string | null>(null);
  const currentWorkletEntryRef = useRef<SentenceState | null>(null);
  const lastRequestIdRef = useRef<string | null>(null);
  // 追踪每个 requestId 下尚未完成的 sentenceId 集合及动画是否已触发
  const requestSentenceMapRef = useRef(
    new Map<string, { pending: Set<string>; triggered: boolean }>(),
  );

  // 一个句子多个 chunk 到来时缓存提供到 Worklet 的通道数组
  // 将解码后的 PCM 数据暂存到句子的队列里，等待此句子被激活后再推送到 Worklet。
  const queueWorkletChannels = (entry: SentenceState, channelData: Float32Array[]) => {
    if (!entry.workletBuffers) {
      entry.workletBuffers = [];
    }
    entry.workletBuffers.push(channelData);
  };

  // 每次向 Worklet 推送数据前确保时序正确，并把 channel.buffer 归还给 Worklet
  // 把 PCM 通道数据通过 MessagePort 发送给 Worklet，并做好环形缓冲状态重置。
  const sendToWorklet = (entry: SentenceState, channelData: Float32Array[]) => {
    const port = workletPortRef.current;
    if (!port) {
      queueWorkletChannels(entry, channelData);
      return;
    }
    entry.workletDrained = false;
    port.postMessage(
      {
        type: "push",
        channelData,
      },
      channelData.map((channel) => channel.buffer),
    );
  };

  // 如果当前正在播放的句子就是目标句子，立即发送数据，否则入队等待。
  const sendOrQueueWorkletChannels = (
    sentenceId: string,
    entry: SentenceState,
    channelData: Float32Array[],
  ) => {
    // 如果当前正在播放的句子就是目标句子则直接推送，否则做异步缓存
    if (
      currentSentenceIdRef.current === sentenceId &&
      currentWorkletSentenceIdRef.current === sentenceId
    ) {
      sendToWorklet(entry, channelData);
      return;
    }
    queueWorkletChannels(entry, channelData);
  };

  // 逐条发送累计的 PCM 数据，保证新句子的缓冲在切换时被刷新。
  const flushWorkletBuffers = (entry: SentenceState) => {
    if (!entry.workletBuffers?.length) {
      return;
    }
    entry.workletBuffers.forEach((channels) => {
      sendToWorklet(entry, channels);
    });
    entry.workletBuffers = [];
  };

  // 注册 requestId 与句子的对应关系，方便识别整轮 TTS 是否完成
  const registerSentenceForRequest = (requestId: string, sentenceId: string) => {
    if (!requestId) {
      return;
    }
    const record = requestSentenceMapRef.current.get(requestId);
    if (record) {
      record.pending.add(sentenceId);
      return;
    }
    requestSentenceMapRef.current.set(requestId, {
      pending: new Set([sentenceId]),
      triggered: false,
    });
  };

  // 当某句播放结束时，通知对应的 request 集合并在全部完成时切换舞蹈动画
  const handleRequestCompletionForSentence = (sentenceId: string, requestId?: string) => {
    if (!requestId) {
      return;
    }
    const record = requestSentenceMapRef.current.get(requestId);
    if (!record) {
      return;
    }
    record.pending.delete(sentenceId);
    if (record.pending.size !== 0) {
      return;
    }
    requestSentenceMapRef.current.delete(requestId);
    if (record.triggered) {
      return;
    }
    record.triggered = true;
    switchToAnimationById("idle1");
    play();
  };

  // 使用 AudioContext 解码当前 chunk 为 PCM，并交由上面的发送/排队逻辑处理。
  const decodeChunkForWorklet = (sentenceId: string, entry: SentenceState, chunk: Uint8Array) => {
    if (!entry.useWorklet) {
      return;
    }
    const floatChannel = buildFloat32ChannelFromPcm(chunk);
    if (!floatChannel) {
      console.warn("ttsAudioPlayer: PCM chunk 无法转换，丢弃", sentenceId);
      entry.useWorklet = false;
      return;
    }
    sendOrQueueWorkletChannels(sentenceId, entry, [floatChannel]);
  };
  
  // 当前句子播放结束或被清理时释放资源，并从状态集合移除。
  const cleanupEntry = useCallback((sentenceId: string) => {
    const entry = sentencesRef.current.get(sentenceId);
    if (!entry) {
      return;
    }
    entry.workletBuffers = [];
    entry.useWorklet = undefined;
    entry.workletDrained = false;
    sentencesRef.current.delete(sentenceId);
  }, []);

  // 对外提供的快速中断逻辑：立即停止播放、清空队列并重置音频上下文。
  const stopTtsPlayback = useCallback(() => {
    // 清理播放队列与正在播放标记
    queueRef.current = [];
    isPlayingRef.current = false;
    currentSentenceIdRef.current = null;
    currentWorkletSentenceIdRef.current = null;
    currentWorkletEntryRef.current = null;
    // 清空所有缓存的句子状态
    const pendingIds = Array.from(sentencesRef.current.keys());
    pendingIds.forEach((id) => cleanupEntry(id));
    sentencesRef.current.clear();
    // 通知 Worklet 复位，防止保留旧的缓冲
    workletPortRef.current?.postMessage({ type: "resetState" });
    requestSentenceMapRef.current.clear();
    const context = audioContextRef.current;
    if (context) {
      void context.suspend().catch(() => {});
    }
  }, [cleanupEntry]);

  const enqueueSentence = (sentenceId: string) => {
    // 将状态完整的句子放入播放队列，避免重复入列
    const entry = sentencesRef.current.get(sentenceId);
    if (!entry || entry.enqueued) {
      return;
    }
    entry.enqueued = true;
    queueRef.current.push(sentenceId);
    playNextFromQueue();
  };

  // 启动 Worklet 播放路径：恢复音频上下文，刷新 Worklet 状态，立刻消费缓冲并标记当前播放句子。
  const startWorkletPlayback = (sentenceId: string, entry: SentenceState) => {
    const context = audioContextRef.current;
    const port = workletPortRef.current;
    if (!context || !port) {
      return false;
    }
    context.resume().catch(() => {
      // 继续播放即使 resume 被阻止
    });
    currentWorkletSentenceIdRef.current = sentenceId;
    currentWorkletEntryRef.current = entry;
    entry.workletDrained = false;
    port.postMessage({ type: "resetState" });
    flushWorkletBuffers(entry);
    isPlayingRef.current = true;
    currentSentenceIdRef.current = sentenceId;
    return true;
  };

  // 根据当前播放状态调度 Worklet，只在 Worklet 可用且 idle 时将队列头送入播放。
  const playNextFromQueue = () => {
    if (isPlayingRef.current) {
      return;
    }

    while (queueRef.current.length) {
      const nextId = queueRef.current[0];
      const entry = sentencesRef.current.get(nextId);
      if (!entry) {
        // 未找到条目可能因为播放过程中被删除，直接跳过
        queueRef.current.shift();
        continue;
      }

      if (!entry.useWorklet) {
        // 当前音频格式不支持 Worklet，跳过以免卡住队列
        console.warn("ttsAudioPlayer: 当前格式不支持 Worklet，忽略句子", nextId, entry.format);
        queueRef.current.shift();
        cleanupEntry(nextId);
        continue;
      }

      if (!workletReadyRef.current || !workletPortRef.current) {
        // 等待 AudioWorklet 初始化完成再播放
        return;
      }

      const started = startWorkletPlayback(nextId, entry);
      if (started) {
        queueRef.current.shift();
        return;
      }
      entry.useWorklet = false;
      queueRef.current.shift();
      cleanupEntry(nextId);
    }
  };

  // Worklet 播放完成后的回调：清理当前句子，重置播放标记并尝试下一个队列。
  const finalizeWorkletPlayback = () => {
    const sentenceId = currentWorkletSentenceIdRef.current;
    if (!sentenceId) {
      return;
    }
    const entry = sentencesRef.current.get(sentenceId);
    const requestId = entry?.requestId;
    cleanupEntry(sentenceId);
    handleRequestCompletionForSentence(sentenceId, requestId);
    currentWorkletSentenceIdRef.current = null;
    currentWorkletEntryRef.current = null;
    isPlayingRef.current = false;
    currentSentenceIdRef.current = null;
    playNextFromQueue();
  };

  // 监听 Worklet 发来的事件，用于记录播放延迟及判断缓冲区是否耗尽。
  const handleWorkletMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data.type !== "string") {
      return;
    }
    const entry = currentWorkletEntryRef.current;
    const sentenceId = currentWorkletSentenceIdRef.current;
    if (data.type === "started" && entry && sentenceId) {
      // Worklet 首次启动输出时刻，记录播放延迟
      logPlaybackLatency(sentenceId, entry);
    }
    if (data.type === "buffer-drained" && entry) {
      entry.workletDrained = true;
      if (entry.isComplete) {
        finalizeWorkletPlayback();
      }
    }
  };

  useEffect(() => {
    if (typeof AudioContext === "undefined") {
      console.warn("ttsAudioPlayer: 当前浏览器不支持 AudioContext / AudioWorklet");
      return undefined;
    }
    let canceled = false;
    const context = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = context;
    // 异步加载自定义的 Worklet 处理器，回调中再连接到音频图。
    const initWorklet = async () => {
      try {
        await context.audioWorklet.addModule("/audio-worklets/tts-ring-processor.js");
        if (canceled) {
          return;
        }
        const node = new AudioWorkletNode(context, "tts-ring-processor", {
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.port.onmessage = handleWorkletMessage;
        node.connect(context.destination);
        workletNodeRef.current = node;
        workletPortRef.current = node.port;
        workletReadyRef.current = true;
        playNextFromQueue();
      } catch (error) {
        console.warn("ttsAudioPlayer: 初始化 AudioWorklet 失败", error);
      }
    };
    initWorklet();
    return () => {
      canceled = true;
      workletReadyRef.current = false;
      workletNodeRef.current?.disconnect();
      workletNodeRef.current = null;
      workletPortRef.current = null;
      audioContextRef.current = null;
      context.close();
    };
  }, []);

  useEffect(() => {
    // 订阅后台 WebSocket 消息，按事件类型构建句子数据上下文
    const dismantle = subscribe((event) => {
      const parsed = describeEvent(event);
      if (!parsed || typeof parsed.event !== "string") {
        return;
      }

      const payload = parsed.data ?? {};

      const { echoTimestamp } = payload;
      const parsedEchoTimestamp =
        typeof echoTimestamp === "number" ? echoTimestamp : Number(echoTimestamp);
      // 只有 timestampWatermark 为 null 或 echoTimestamp 不小于 watermark 时才继续处理，保证新指令抢占资源
      if (
        timestampWatermark !== null &&
        (!Number.isFinite(parsedEchoTimestamp) || parsedEchoTimestamp < timestampWatermark)
      ) {
        return;
      }

      const sentenceId = safeString(payload.sentenceId);
      switch (parsed.event) {
        case "tts-audio-start": {
          if (!sentenceId) {
            break;
          }
          const actionId = safeString(payload.action);
          const requestId = safeString(payload.requestId);
          const isRepeatRequest = !!requestId && requestId === lastRequestIdRef.current;
          // 处理动画切换：仅在首次接收到相同 requestId 时才切换，避免重复触发动画
          if(!isRepeatRequest&&actionId && allAnimationsLoaded) {
            const animationExists = animations.some((animation) => animation.id === actionId);
            console.log(animationExists,actionId, 'animationExists')
            if (animationExists) {
              // 动作字段对应的动画 id 在所有资源加载完成后直接切换并播放，增强交互体验
              switchToAnimationById(actionId);
                play();
            }
          }
          if (requestId) {
            lastRequestIdRef.current = requestId;
          }
          const format = safeString(payload.format) || "mp3";
          // 创建句子的播放状态，初始缓存准备空数组
          sentencesRef.current.set(sentenceId, {
            format,
            useWorklet: supportsWorkletFormat(format),
            workletBuffers: [],
            workletDrained: false,
            requestId: requestId || undefined,
          });
          if (requestId) {
            registerSentenceForRequest(requestId, sentenceId);
          }
          enqueueSentence(sentenceId);
          break;
        }
        case "tts-audio-chunk": {
          if (!sentenceId) {
            break;
          }
          const entry = sentencesRef.current.get(sentenceId);
          const base64 = safeString(payload.base64);
          if (!base64 || !entry) {
            break;
          }
          if (!entry.firstChunkTimestamp) {
            entry.firstChunkTimestamp = getNow(); // 记录首次 chunk 到达的时间戳供延迟分析
          }
          const chunk = base64ToUint8Array(base64);
          // 将 chunk 解码并推入 Worklet 缓存
          decodeChunkForWorklet(sentenceId, entry, chunk);
          if (!isPlayingRef.current) {
            playNextFromQueue();
          }
          break;
        }
        case "tts-audio-complete": {
          if (!sentenceId) {
            break;
          }
          const entry = sentencesRef.current.get(sentenceId);
          if (!entry) {
            break;
          }
          // 收到 complete 表示不会再有 chunk，尝试让 Worklet 结束并清理缓存
          entry.isComplete = true;
          if (entry.useWorklet && entry.workletDrained) {
            finalizeWorkletPlayback();
          } else if (!entry.useWorklet) {
            const requestId = entry.requestId;
            cleanupEntry(sentenceId);
            handleRequestCompletionForSentence(sentenceId, requestId);
            queueRef.current = queueRef.current.filter((id) => id !== sentenceId);
          }
          break;
        }
        default:
          break;
      }
    });

    return () => {
      // 取消订阅并立即停止所有未完成的播放，避免内存泄漏
      dismantle();
      stopTtsPlayback();
    };
  }, [
    subscribe,
    allAnimationsLoaded,
    animations,
    switchToAnimationById,
    play,
    stopTtsPlayback,
    timestampWatermark,
  ]);

  /**
   * 直接播放一段外部传入的语音数据（支持 Float32/Int16/Uint8/普通数字数组）。
   * 会复用现有 Worklet 播放链路，自动排队并在播放完成后回收状态。
   */
  const playSpeechBuffer = (
    audio: Float32Array | Int16Array | Uint8Array | number[],
    options?: PlaySpeechOptions,
  ) => {
    const floatChannel = normalizeToFloat32(audio);
    if (!floatChannel?.length) {
      console.warn("ttsAudioPlayer: playSpeechBuffer 收到的音频为空，已跳过");
      return;
    }

    const format = options?.format ?? "pcm";
    const sentenceId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const requestId = options?.requestId ?? sentenceId;
    const entry: SentenceState = {
      format,
      useWorklet: supportsWorkletFormat(format),
      workletBuffers: [],
      workletDrained: false,
      requestId,
    };
    sentencesRef.current.set(sentenceId, entry);
    // 本地播放也要切换到说话动画，保持与服务端 TTS 一致的交互反馈
    if (allAnimationsLoaded && animations.some((animation) => animation.id === "talk")) {
      switchToAnimationById("talk");
      play();
    }
    registerSentenceForRequest(requestId, sentenceId);
    // 将本地语音直接送入 Worklet，如果当前未轮到该句子会先暂存
    sendOrQueueWorkletChannels(sentenceId, entry, [floatChannel]);
    entry.isComplete = true; // 声明不会再追加 chunk，方便 Worklet 耗尽后及时收尾
    enqueueSentence(sentenceId);
    if (!isPlayingRef.current) {
      playNextFromQueue();
    }
  };

  return { stopTtsPlayback, playSpeechBuffer };
};
