'use client'

/**
 * 聊天消息的角色类型：区分助手与用户
 */
export type MessageRole = 'assistant' | 'user'

/**
 * 统一的聊天消息数据结构定义，供 Chatbot 相关组件共享
 */
export interface Message {
  id: string
  role: MessageRole
  content: string
}

/**
 * 生成前端专用的唯一消息 ID，用于 messageKey 和流式更新的匹配
 */
export function createMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
}
