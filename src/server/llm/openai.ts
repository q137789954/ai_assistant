import OpenAI from "openai";

/**
 * OpenAI 服务端适配层（预留）
 * ------------------------------------------------------------
 * 当前项目主要接入的是 xAI（Grok），但在一些场景你可能也会需要：
 * - 直接调用 OpenAI 官方接口
 * - 或者接入其它 OpenAI 兼容网关
 *
 * 这里提供一个最小的“OpenAI Client 单例”封装，避免到处 new OpenAI。
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

let openaiClient: OpenAI | null = null;

/**
 * 获取 OpenAI Client（单例）
 * - 未配置 OPENAI_API_KEY 时会抛错，方便及早发现环境问题
 */
export function getOpenAIClient() {
  if (openaiClient) {
    return openaiClient;
  }
  if (!OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY：请在 .env 中配置 OpenAI 的 API Key");
  }
  openaiClient = new OpenAI({
    apiKey: OPENAI_API_KEY,
    timeout: 360000,
  });
  return openaiClient;
}

