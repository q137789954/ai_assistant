// utils/audio.ts
export function float32ToInt16(frame: Float32Array): Int16Array {
  const out = new Int16Array(frame.length)
  for (let i = 0; i < frame.length; i++) {
    // 限制采样值范围在 [-1,1] 之间，防止溢出后再放缩
    const s = Math.max(-1, Math.min(1, frame[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
