import RPCClient from "@alicloud/pop-core";
import { Socket } from "node:net";

export type AliyunConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  appKey: string;
  endpoint: string;
  path: string;
  format: string;
  version: string;
  metaEndpoint: string;
  region: string;
};

const DEFAULT_REDIS_PORT = 6379;
const REDIS_KEY = process.env.ALIYUN_ASR_REDIS_TOKEN_KEY || "aliyun:nls:token";

const redisEndpoint = process.env.ALIYUN_ASR_REDIS_URL;
const redisHost = process.env.ALIYUN_ASR_REDIS_HOST;
const redisPortEnv = process.env.ALIYUN_ASR_REDIS_PORT;
const redisPassword = process.env.ALIYUN_ASR_REDIS_PASSWORD;

type RedisConfig = {
  host: string;
  port: number;
  password?: string;
};

/**
 * 解析 Redis 目标配置，允许通过 URL 或分别设置 host/port。
 */
const buildRedisConfig = (): RedisConfig | null => {
  if (redisEndpoint) {
    try {
      const parsed = new URL(redisEndpoint);
      const host = parsed.hostname || "127.0.0.1";
      const port = Number(parsed.port) || DEFAULT_REDIS_PORT;
      const password = parsed.password || undefined;
      return { host, port, password };
    } catch (error) {
      console.warn("aliyunToken: Redis URL 解析失败，缓存功能将被禁用", error);
      return null;
    }
  }
  if (redisHost) {
    const port = Number(redisPortEnv || "") || DEFAULT_REDIS_PORT;
    return { host: redisHost, port, password: redisPassword };
  }
  return null;
};

/**
 * 一个简化版的 Redis 客户端，只支持用于 Token 缓存的基本 GET/SET 操作。
 */
class SimpleRedisClient {
  private socket?: Socket;
  private buffer = "";
  private pending: Array<{ resolve: (value: string | null) => void; reject: (reason: Error) => void }> = [];
  private connecting?: Promise<void>;
  private authenticated = false;
  private connected = false;

  constructor(private readonly host: string, private readonly port: number, private readonly password?: string) {}

  /**
   * 将命令转换为符合 RESP 协议的文本，供 socket 直接写入。
   */
  private encodeCommand(command: string[]) {
    const parts = [`*${command.length}`];
    for (const part of command) {
      const content = Buffer.from(part, "utf8");
      parts.push(`$${content.length}`);
      parts.push(part);
    }
    return parts.join("\r\n") + "\r\n";
  }

  /**
   * 解析 Redis 的 RESP 返回值，支持简单字符串、整数和 bulk string。
   */
  private parseResponse(buffer: string):
    | { value: string | null; rest: string }
    | { error: string; rest: string }
    | null {
    if (!buffer) {
      return null;
    }
    const delimiter = "\r\n";
    const index = buffer.indexOf(delimiter);
    if (index < 0) {
      return null;
    }
    const line = buffer.slice(0, index);
    const restAfterLine = buffer.slice(index + 2);
    const prefix = line[0];
    if (prefix === "+") {
      return { value: line.slice(1), rest: restAfterLine };
    }
    if (prefix === "-") {
      return { error: line.slice(1), rest: restAfterLine };
    }
    if (prefix === ":") {
      return { value: line.slice(1), rest: restAfterLine };
    }
    if (prefix === "$") {
      const length = Number(line.slice(1));
      if (Number.isNaN(length)) {
        return { error: `无法解析 RESP 长度 ${line}`, rest: restAfterLine };
      }
      if (length === -1) {
        return { value: null, rest: restAfterLine };
      }
      const needed = index + 2 + length + 2;
      if (buffer.length < needed) {
        return null;
      }
      const value = buffer.slice(index + 2, index + 2 + length);
      const rest = buffer.slice(needed);
      return { value, rest };
    }
    return { error: `不支持的 RESP 前缀 ${prefix}`, rest: restAfterLine };
  }

  /**
   * 收到数据后尝试持续解析，按顺序完成所有 pending 的命令。
   */
  private handleData(chunk: string) {
    this.buffer += chunk;
    while (this.pending.length) {
      const parsed = this.parseResponse(this.buffer);
      if (!parsed) {
        break;
      }
      this.buffer = parsed.rest;
      const entry = this.pending.shift()!;
      if ("error" in parsed) {
        entry.reject(new Error(parsed.error));
      } else {
        entry.resolve(parsed.value);
      }
    }
  }

  /**
   * 在连接异常时拒绝所有排队中的请求，防止逻辑挂起。
   */
  private rejectAll(error: Error) {
    this.connected = false;
    this.authenticated = false;
    while (this.pending.length) {
      const entry = this.pending.shift()!;
      entry.reject(error);
    }
  }

  /**
   * 保证 socket 已连接且（如果设置了密码）已完成 AUTH。
   */
  private async ensureConnected() {
    if (this.connected && (!this.password || this.authenticated)) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.socket = new Socket();
    this.socket.setEncoding("utf8");
    this.socket.setKeepAlive(true);
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("close", () => {
      this.connected = false;
      this.authenticated = false;
      this.socket = undefined;
    });
    this.socket.on("error", (error) => {
      this.rejectAll(error);
    });

    const connectionPromise = new Promise<void>((resolve, reject) => {
      this.socket!.once("connect", async () => {
        this.connected = true;
        try {
          if (this.password) {
            await this.sendRawCommand(["AUTH", this.password]);
            this.authenticated = true;
          }
          resolve();
        } catch (error) {
          reject(error as Error);
          this.rejectAll(error as Error);
        }
      });
      this.socket!.once("error", (error) => {
        reject(error);
        this.rejectAll(error);
      });
    });
    this.socket.connect(this.port, this.host);
    const finalPromise = connectionPromise.finally(() => {
      this.connecting = undefined;
    });
    this.connecting = finalPromise;
    return finalPromise;
  }

  /**
   * 在已连接的前提下直接向 Redis 发送命令并排队等待返回。
   */
  private sendRawCommand(command: string[]) {
    return new Promise<string | null>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Redis 连接尚未初始化"));
        return;
      }
      this.pending.push({ resolve, reject });
      this.socket.write(this.encodeCommand(command));
    });
  }

  private async sendCommand(command: string[]) {
    await this.ensureConnected();
    return this.sendRawCommand(command);
  }

  /**
   * 读取某个 key 的缓存值，调用方可直接判断是否存在。
   */
  async get(key: string) {
    const value = await this.sendCommand(["GET", key]);
    return value;
  }

  /**
   * 写入带过期时间的缓存数据，过期秒数可选。
   */
  async set(key: string, value: string, expireSeconds?: number) {
    const command = ["SET", key, value];
    if (expireSeconds && expireSeconds > 0) {
      command.push("EX", String(expireSeconds));
    }
    await this.sendCommand(command);
  }
}

const redisConfig = buildRedisConfig();
// 如果未配置 Redis，就暂时不启用缓存逻辑。
const redisClient = redisConfig
  ? new SimpleRedisClient(redisConfig.host, redisConfig.port, redisConfig.password)
  : null;

/**
 * 基于 AccessKey 构造阿里云 NLS 元信息服务的 RPC 客户端。
 */
const createMetaClient = (config: AliyunConfig) =>
  new RPCClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: `https://${config.metaEndpoint}`,
    apiVersion: config.version,
  });

/**
 * 计算 Token 相对于当前时间的剩余秒数，并为安全留出缓冲时间。
 */
const calculateExpireSeconds = (expireTime?: string) => {
  if (!expireTime) {
    return 55 * 60;
  }
  const expire = Date.parse(expireTime);
  if (Number.isNaN(expire)) {
    return 55 * 60;
  }
  const seconds = Math.floor((expire - Date.now()) / 1000) - 30;
  return Math.max(30, seconds);
};

/**
 * 从环境变量聚合生成供各模块使用的阿里云 ASR 配置结构。
 */
function getAliyunConfig() {
  const accessKeyId = process.env.ALIYUN_ASR_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ASR_ACCESS_KEY_SECRET;
  const appKey = process.env.ALIYUN_ASR_APP_KEY;
  const endpoint = process.env.ALIYUN_ASR_ENDPOINT || "nls-gateway.cn-shanghai.aliyuncs.com";
  const rawPath = process.env.ALIYUN_ASR_PATH || "/stream/v1/ir";
  const format = process.env.ALIYUN_ASR_FORMAT || "pcm";
  const version = process.env.ALIYUN_ASR_VERSION || "2019-02-28";
  const metaEndpoint = process.env.ALIYUN_ASR_META_ENDPOINT || "nls-meta.cn-shanghai.aliyuncs.com";
  const region = process.env.ALIYUN_ASR_REGION || "cn-shanghai";

  if (!accessKeyId || !accessKeySecret || !appKey) {
    throw new Error("缺少阿里云 ASR 的认证配置，请在 .env 中补全 ALIYUN_ASR_ACCESS_KEY_ID/SECRET/APP_KEY");
  }

  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return {
    accessKeyId,
    accessKeySecret,
    appKey,
    endpoint,
    path,
    format,
    version,
    metaEndpoint,
    region,
  } as AliyunConfig;
}

/**
 * 不经过缓存直接向阿里云请求新 Token，并尝试将结果写入 Redis。
 */
const requestAliyunToken = async (config: AliyunConfig) => {
  const client = createMetaClient(config);
  const result = (await client.request("CreateToken", { RegionId: config.region })) as {
    Token?: { SecurityToken?: string; ExpireTime?: string };
  };
  const token = result.Token?.SecurityToken;
  if (!token) {
    throw new Error(`阿里云 Token 接口返回异常：${JSON.stringify(result)}`);
  }
  const expireSeconds = calculateExpireSeconds(result.Token?.ExpireTime);
  if (redisClient) {
    try {
      await redisClient.set(REDIS_KEY, token, expireSeconds);
    } catch (error) {
      console.warn("aliyunToken: 缓存 Token 到 Redis 失败", error);
    }
  }
  return token;
};

/**
 * 获取阿里云临时 Token：优先走 Redis 缓存，缓存失效则从阿里云重新获取。
 */
export const getAliyunToken = async (config: AliyunConfig) => {
  if (redisClient) {
    try {
      const cached = await redisClient.get(REDIS_KEY);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.warn("aliyunToken: 从 Redis 读取 Token 失败，继续请求新 Token", error);
    }
  }
  return requestAliyunToken(config);
};

export { getAliyunConfig };
