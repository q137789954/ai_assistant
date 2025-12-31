import type { Metadata } from "next";

// 隐私政策要点，未来如接入更多数据源可在此扩展
const sections = [
  {
    title: "我们收集的信息",
    items: [
      "账户数据：如邮箱、昵称、登录记录与安全日志。",
      "使用数据：交互指令、语音/文本片段、设备与浏览器信息、粗粒度位置信息。",
      "诊断数据：错误日志、性能指标、崩溃报告，用于改进稳定性。",
    ],
  },
  {
    title: "我们如何使用",
    items: [
      "身份验证、账号保护与风险控制。",
      "提供语音/动画等核心功能，并优化识别与生成效果。",
      "用于调试、监控与产品改进，必要时脱敏或聚合处理。",
    ],
  },
  {
    title: "Cookie 与本地存储",
    items: [
      "用于会话保持、偏好设置与必要的安全校验。",
      "可通过浏览器设置管理或清除，但可能影响登录和体验。",
    ],
  },
  {
    title: "共享与披露",
    items: [
      "我们不会出售个人信息。仅在履行服务、法律要求或获得同意的情况下与受信任的服务提供商共享。",
      "当涉及安全威胁、侵权或违法行为时，我们可能依据法律协助调查。",
    ],
  },
  {
    title: "数据保留与删除",
    items: [
      "数据会在完成用途或法律要求的期限后删除或匿名化处理。",
      "您可联系我们删除账户及相关数据，但某些记录可能因合规要求而延后或保留。",
    ],
  },
  {
    title: "安全措施",
    items: [
      "采用传输加密、访问控制与审计机制降低风险，但互联网传输始终存在残余风险。",
      "请避免在输入中提交敏感个人信息或机密内容。",
    ],
  },
  {
    title: "您的权利",
    items: [
      "您可请求访问、更正或删除个人信息，并可选择退出部分非必要的数据收集（如分析 Cookie）。",
      "如对隐私有疑问或投诉，可通过联系方式与我们沟通。",
    ],
  },
  {
    title: "更新",
    items: [
      "隐私政策更新后将发布在此页面，重大变更可能以通知形式提醒。",
      "继续使用服务即表示接受更新内容。",
    ],
  },
  {
    title: "联系我们",
    items: [
      "若需行使数据权利或了解更多信息，请通过支持渠道与我们联系。",
    ],
  },
];

export const metadata: Metadata = {
  title: "ROAST.AI - Privacy Policy",
  description: "ROAST.AI 隐私政策",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh w-full bg-[#0a0a0a] text-white px-6 py-12">
      <div className="mx-auto w-full max-w-4xl space-y-10">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.2em] text-secondary">
            Legal
          </p>
          <h1 className="text-4xl font-black text-primary italic">Privacy</h1>
          <p className="text-sm leading-relaxed text-white/80">
            我们重视您的隐私与数据安全。以下说明我们收集哪些信息、如何使用以及您的权利。
          </p>
        </header>

        <section className="grid gap-6">
          {sections.map((section) => (
            <div
              key={section.title}
              className="rounded-lg border border-white/10 bg-white/5 px-5 py-4"
            >
              <h2 className="text-xl font-semibold text-primary">
                {section.title}
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-white/80 leading-relaxed">
                {section.items.map((item) => (
                  <li key={item} className="pl-2">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <footer className="flex flex-wrap items-center gap-4 text-sm text-secondary">
          <span>最近更新：2024-05-01</span>
          <a
            href="/terms"
            className="underline decoration-dotted underline-offset-4 hover:text-primary"
          >
            查看服务条款
          </a>
          <a
            href="/register"
            className="underline decoration-dotted underline-offset-4 hover:text-primary"
          >
            返回注册页
          </a>
          <a
            href="/"
            className="underline decoration-dotted underline-offset-4 hover:text-primary"
          >
            回到首页
          </a>
        </footer>
      </div>
    </main>
  );
}
