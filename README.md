This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## WebSocket 服务

为了规避 Edge Serverless 对长连接的限制，本项目将实时通信单独拆出为一个基于 `socket.io` 的 Node 服务。使用时可以：

1. 运行 `pnpm socket-server` 启动 `socket.io` 服务（默认监听 `4000` 端口，可通过 `SOCKET_SERVER_PORT` 环境变量调整）。
2. 启动 Next.js 项目 `pnpm dev`，前端会通过 `NEXT_PUBLIC_SOCKET_SERVER_URL`（默认 `http://localhost:4000`）连接到该服务。
3. 如需跨域，可以通过 `SOCKET_SERVER_CORS_ORIGIN` 定制允许的来源；在生产环境把 `NEXT_PUBLIC_SOCKET_SERVER_URL` 指向部署后的 socket 服务地址即可。

## 登录注册（next-auth + Prisma + PostgreSQL）

### 1) 环境变量

请在 `.env` 中确保已配置（参考 `.env.example`）：

- `DATABASE_URL`：PostgreSQL 连接串
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google OAuth Client
- `NEXTAUTH_URL`：本地一般为 `http://localhost:3000`
- `NEXTAUTH_SECRET`：随机长字符串（建议 `openssl rand -base64 48` 生成）

Google Console 里需要配置回调地址（Redirect URI）：

- `http://localhost:3000/api/auth/callback/google`

### 2) 初始化数据库（Prisma）

```bash
pnpm install
pnpm exec prisma migrate dev --name init
```

### 3) 使用方式

- 登录页：`/login`
- 注册页：`/register`
