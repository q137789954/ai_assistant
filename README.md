# AI Assistant

一个基于 Next.js + Socket.IO 的实时语音/文本聊天应用，内置“吐槽对战”玩法、订阅支付、用户画像与多种服务端能力。前端使用 App Router，实时链路独立成 Node Socket 服务以规避长连接限制。

## 功能概览

- 实时聊天：WebSocket + Socket.IO 推送流式回复与状态事件
- 语音能力：前端 VAD 语音片段采集，服务端 ASR 接入，TTS 流式回放
- 吐槽对战：回合制破防值、胜利判定、排行榜与统计
- 用户系统：注册/登录/找回密码，支持 Google OAuth
- 订阅与支付：Creem 订阅、Webhook 回调与订阅状态校验
- 邮件服务：Resend 发送验证码/通知邮件
- 用户画像与对话压缩：会话上下文裁剪、用户画像更新

## 技术栈

- Next.js 16 + React 19（App Router）
- Prisma + PostgreSQL
- NextAuth.js
- Socket.IO / WebSocket
- Ant Design + Tailwind CSS + Motion
- Pixi.js / Live2D 动画
- OpenAI SDK（xAI 兼容接口）

## 目录结构

- `src/app`：页面、组件、Providers、API Routes
- `src/server`：Socket 服务、对话处理、TTS/ASR、用户画像
- `prisma`：数据库模型与迁移
- `public`：音频/视频资源与工作器

## 快速开始

### 1) 安装依赖

```bash
pnpm install
```

### 2) 配置环境变量

```bash
cp .env.example .env
```

按需填写 `.env`，以下是常用字段说明：

- `NEXT_PUBLIC_APP_URL`：站点公开地址
- `DATABASE_URL`：PostgreSQL 连接串
- `NEXTAUTH_URL` / `NEXTAUTH_SECRET`：NextAuth 基本配置
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google OAuth
- `GROKKINGAI_API_KEY`：xAI（Grok）API Key
- `FISH_API_KEY`：Fish Audio TTS Key
- `SOCKET_SERVER_PORT`：Socket 服务端口
- `SOCKET_SERVER_CORS_ORIGIN`：Socket CORS 白名单
- `RESEND_API_KEY` / `RESEND_FROM`：邮件发送配置
- `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / `CREEM_PRODUCT_ID`：订阅与支付
- `AUTH_SKIP_EMAIL_CODE`：本地跳过邮箱验证码（仅开发环境）

### 3) 初始化数据库

```bash
pnpm prisma:migrate
```

### 4) 启动 Socket 服务

```bash
pnpm client-socket-server
```

### 5) 启动 Web 应用

```bash
pnpm dev
```

应用默认运行在 `http://localhost:3000`。

## 常用脚本

- `pnpm dev`：启动开发环境（自动生成 Prisma Client）
- `pnpm build`：生产构建
- `pnpm start`：启动生产服务
- `pnpm lint`：代码检查
- `pnpm prisma:generate`：生成 Prisma Client
- `pnpm prisma:migrate`：本地迁移数据库
- `pnpm prisma:studio`：数据库可视化管理
- `pnpm client-socket-server`：启动 Socket.IO 服务

## 说明与注意事项

- Socket 服务使用 `NEXTAUTH_SECRET` 校验登录态，未登录将拒绝连接。
- 语音链路依赖浏览器麦克风权限与 TTS/ASR 服务配置。
- 订阅与支付能力依赖 Creem 的产品配置与 Webhook 校验。

## 页面入口

- `/`：主聊天与吐槽对战
- `/login`：登录
- `/register`：注册
- `/forgot-password`：找回密码
- `/subscribe/result`：订阅结果页
- `/terms` / `/privacy`：条款与隐私
