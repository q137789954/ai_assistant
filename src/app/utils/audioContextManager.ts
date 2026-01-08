/**
 * 统一管理全局 AudioContext，确保可在用户手势时解锁，
 * 并让各处复用同一个上下文与 Worklet 模块。
 */

const AUDIO_SAMPLE_RATE = 16000;

let audioContext: AudioContext | null = null;
let workletModuleLoaded = false;

/**
 * 获取或创建 AudioContext。
 * - 如果上下文被关闭则重新创建
 * - 在非浏览器环境返回 null
 */
export const getOrCreateAudioContext = () => {
  if (typeof AudioContext === "undefined") {
    return null;
  }
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    // 重新创建上下文后需要重新加载 Worklet 模块
    workletModuleLoaded = false;
  }
  return audioContext;
};

/**
 * 在用户手势触发时调用，用于解锁音频播放权限。
 */
export const resumeAudioContext = async () => {
  const context = getOrCreateAudioContext();
  if (!context) {
    return null;
  }
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      // 某些浏览器会在多次调用时抛错，这里吞掉以免影响进入流程
    }
  }
  return context;
};

/**
 * 确保指定的 Worklet 模块被加载（仅加载一次）。
 */
export const ensureWorkletModule = async (moduleUrl: string) => {
  const context = getOrCreateAudioContext();
  if (!context) {
    throw new Error("AudioContext 不可用");
  }
  if (!workletModuleLoaded) {
    await context.audioWorklet.addModule(moduleUrl);
    workletModuleLoaded = true;
  }
  return context;
};
