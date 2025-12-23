// 用于在 Worklet 内部维护一个固定大小的环形缓冲区，支持多通道读取/写入。
class RingBuffer {
  constructor(capacity, channelCount) {
    this.capacity = capacity;
    this.channelCount = Math.max(1, channelCount);
    this.buffers = Array.from({ length: this.channelCount }, () => new Float32Array(capacity));
    this.writeIndex = 0;
    this.readIndex = 0;
    this.availableFrames = 0;
  }

  // 根据实际通道数量扩展内部缓冲区，避免越界。
  ensureChannelCount(count) {
    if (count <= this.channelCount) {
      return;
    }
    const extra = count - this.channelCount;
    this.buffers.push(...Array.from({ length: extra }, () => new Float32Array(this.capacity)));
    this.channelCount = count;
  }

  // 重置索引与计数，清空缓冲区。
  reset() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.availableFrames = 0;
    for (const buffer of this.buffers) {
      buffer.fill(0);
    }
  }

  // 将新的一段通道数据写入环形缓冲，将旧数据顺序覆盖以保持最新。
  write(channelData) {
    if (!channelData.length) {
      return;
    }
    this.ensureChannelCount(channelData.length);
    const frames = channelData[0].length;
    for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
      if (this.availableFrames >= this.capacity) {
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.availableFrames -= 1;
      }
      for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
        const channelSource = channelData[channelIndex] ?? channelData[0];
        this.buffers[channelIndex][this.writeIndex] = channelSource[frameIndex] ?? 0;
      }
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.availableFrames += 1;
    }
  }

  // 从环形缓冲读取数据填充输出帧，不足的部分补 0。
  read(output, frameCount) {
    const framesToRead = Math.min(frameCount, this.availableFrames);
    const channelCount = Math.min(this.channelCount, output.length);
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channelOutput = output[channelIndex];
      for (let i = 0; i < framesToRead; i += 1) {
        channelOutput[i] = this.buffers[channelIndex][this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.capacity;
      }
      for (let i = framesToRead; i < frameCount; i += 1) {
        channelOutput[i] = 0;
      }
    }
    for (let channelIndex = channelCount; channelIndex < output.length; channelIndex += 1) {
      output[channelIndex].fill(0);
    }
    this.availableFrames -= framesToRead;
    return framesToRead;
  }
}

// AudioWorkletProcessor 负责编排环形缓冲中的音频数据并输出到设备。
class TtsRingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new RingBuffer(48000 * 4, 1);
    this.started = false;
    this.drainedNotified = false;
    this.port.onmessage = this.handleMessage.bind(this);
  }

  // 响应主线程的指令，包括推送音频数据和重置状态。
  handleMessage(event) {
    const { data } = event;
    if (!data || typeof data.type !== "string") {
      return;
    }
    if (data.type === "push" && Array.isArray(data.channelData)) {
      this.buffer.write(data.channelData);
      this.drainedNotified = false;
    } else if (data.type === "resetState") {
      this.buffer.reset();
      this.started = false;
      this.drainedNotified = false;
    }
  }

  // 每次 AudioContext 需要样本时调用，从缓冲区读取并填充输出。
  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) {
      return true;
    }

    const frameCount = output[0].length;
    if (this.buffer.availableFrames === 0) {
      for (const channel of output) {
        channel.fill(0);
      }
      if (this.started && !this.drainedNotified) {
        this.port.postMessage({ type: "buffer-drained" });
        this.drainedNotified = true;
      }
      return true;
    }

    this.buffer.read(output, frameCount);
    if (!this.started) {
      this.started = true;
      this.port.postMessage({ type: "started" });
    }
    this.drainedNotified = false;
    return true;
  }
}

registerProcessor("tts-ring-processor", TtsRingProcessor);
