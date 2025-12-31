import type { Metadata } from "next";

// 静态条款文案配置，便于后续统一维护与更新
const sections = [
  {
    title: "服务概览",
    items: [
      "ROAST.AI 为用户提供语音与动画驱动的交互体验，当前版本可能包含实验性功能。",
      "使用本服务即表示您同意遵守本条款及相关政策，未成年人需在法定监护人同意下使用。",
    ],
  },
  {
    title: "账户与安全",
    items: [
      "您应对账户信息的准确性和安全性负责，不得冒用他人身份或分享凭据。",
      "如发现账户被未授权使用，请立即联系我们，我们将协助冻结或重置账户。",
    ],
  },
  {
    title: "使用规范",
    items: [
      "不得利用本服务从事违法、侵权、恶意攻击或干扰系统的行为。",
      "不得上传或生成含有暴力、色情、仇恨、骚扰或其他不当内容的指令或素材。",
      "我们有权在合理范围内对可疑活动进行限制、暂停或终止，以保障平台安全。",
    ],
  },
  {
    title: "内容与知识产权",
    items: [
      "您保留对自有内容的合法权益，同时授予我们为提供与改进服务所需的使用许可。",
      "平台的代码、模型、界面与品牌等归 ROAST.AI 或其授权方所有，未经许可不得复制或商业使用。",
    ],
  },
  {
    title: "数据与隐私",
    items: [
      "我们按《隐私政策》收集、使用与存储数据，用于身份验证、故障排查与体验优化。",
      "除法律要求或经您同意外，我们不会出售或用于与服务无关的第三方营销。",
    ],
  },
  {
    title: "付费与订阅",
    items: [
      "若未来提供付费功能，费用、续订与退款规则将以对应页面或协议说明为准。",
      "在订阅有效期内的功能或权益可能因技术迭代调整，但我们会尽量提供等值或更佳体验。",
    ],
  },
  {
    title: "免责声明与责任限制",
    items: [
      "服务按“现状”提供，我们不对适用性、稳定性或特定结果作出保证。",
      "在法律允许范围内，对因使用或无法使用服务导致的间接或附带损失，我们不承担责任。",
    ],
  },
  {
    title: "终止与变更",
    items: [
      "您可随时停止使用本服务，我们也可能基于安全或合规考虑终止或限制访问。",
      "条款更新将通过页面公布或通知方式生效，继续使用即视为接受更新。",
    ],
  },
  {
    title: "联系我们",
    items: [
      "如有条款、版权或安全相关问题，请通过支持渠道联系我们，我们将尽快响应。",
    ],
  },
];

export const metadata: Metadata = {
  title: "ROAST.AI - Terms of Service",
  description: "ROAST.AI 服务条款",
};

export default function TermsPage() {
  return (
    <main className="min-h-dvh w-full bg-[#0a0a0a] text-white px-6 py-12">
      <div className="mx-auto w-full max-w-4xl space-y-10">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.2em] text-secondary">
            Legal
          </p>
          <h1 className="text-4xl font-black text-primary italic">Terms</h1>
          <p className="text-sm leading-relaxed text-white/80">
            请在使用 ROAST.AI 前仔细阅读本条款。继续使用即表示您已理解并同意全部内容。
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
            href="/privacy"
            className="underline decoration-dotted underline-offset-4 hover:text-primary"
          >
            查看隐私政策
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
