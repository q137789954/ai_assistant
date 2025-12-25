import type { Dispatch, SetStateAction } from "react";

export type DeviceType = "desktop" | "mobile";

export interface UserSpeechItem {
  id: string; // 用 Date.now + 随机数就行
  audio: Float32Array; // Silero/VAD 输出的 16k PCM
  sampleRate: number; // 固定 16000
  createdAt: number; // 时间戳，方便后面做过期清理等
}

export type GlobalsState = {
  deviceType: DeviceType;
  voiceInputEnabled: boolean;
  /**
   * 记录当前的语音输入是否处于用户正在说话的阶段
   */
  isUserSpeaking: boolean;
  /**
   * 保存还未被处理的用户语音内容，按照录入顺序排入队列
   */
  pendingUserSpeech: UserSpeechItem | null;
  pendingUserSpeechQueue: UserSpeechItem[];
  /**
   * 控制 Chatbot 组件在主页面的是否展示状态，默认不显示
   */
  chatbotVisible: boolean;
  /**
   * 控制个人中心抽屉的是否展示状态
   */
  personalCenterVisible: boolean;
  /**
   * 用户最后一次开始说话/发送对话的 时间戳
   * 早于该时间戳的语音、动作，直接废弃不在播放
   */
  timestampWatermark: number | null;
};

export type GlobalsAction =
  | { type: "SET_DEVICE_TYPE"; payload: DeviceType }
  | { type: "SET_VOICE_INPUT_ENABLED"; payload: boolean }
  | { type: "SET_USER_SPEAKING"; payload: boolean }
  | { type: "ENQUEUE_USER_SPEECH"; payload: UserSpeechItem }
  | { type: "DEQUEUE_USER_SPEECH" }
  | { type: "CLEAR_USER_SPEECH_QUEUE" }
  | { type: "SET_CHATBOT_VISIBILITY"; payload: boolean }
  | { type: "SET_PERSONAL_CENTER_VISIBILITY"; payload: boolean }
  | { type: "SET_SESSION_ID"; payload: string }
  | { type: "SET_CONVERSATION_ID"; payload: string }
  | { type: "SET_TIMESTAMP_WATERMARK"; payload: number | null };

export interface GlobalsContextValue extends GlobalsState {
  dispatch: Dispatch<GlobalsAction>;
  permissionDialogOpen: boolean;
  setPermissionDialogOpen: Dispatch<SetStateAction<boolean>>;
}
