// app/asr-demo/page.tsx
'use client'

export default function AsrDemoPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '24px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <h1 style={{ fontSize: '20px', fontWeight: 600 }}>
        sherpa-onnx WebAssembly ASR Demo (嵌入版)
      </h1>

      <p style={{ fontSize: '14px', color: '#666' }}>
        点击下方 iframe 里的 Start 按钮，允许麦克风权限，然后说话就可以看到识别结果。
        所有 ASR 推理都在浏览器本地（WASM）完成。
      </p>

      <div
        style={{
          flex: 1,
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
        }}
      >
        <iframe
          src="/sherpa-wasm-asr/index.html"
          title="sherpa-onnx wasm asr demo"
          style={{
            width: '100%',
            height: '100vh',
            border: 'none',
          }}
        />
      </div>
    </main>
  )
}
