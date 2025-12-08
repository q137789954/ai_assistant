// 因为这些函数会在多个组件中共享，所以统一放在工具模块中，便于维护
const isNavigatorMediaDevicesAvailable = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/**
 * 查询浏览器对麦克风的权限状态，如果浏览器不支持权限接口则返回 null
 */
export const queryMicrophonePermission = async (): Promise<PermissionState | null> => {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return null
  }

  try {
    const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return permissionStatus.state
  } catch {
    return null
  }
}

/**
 * 请求麦克风访问流，如果浏览器不支持则直接抛出异常，调用方负责捕获
 */
export const requestMicrophoneStream = async (
  constraints?: MediaStreamConstraints
): Promise<MediaStream> => {
  if (!isNavigatorMediaDevicesAvailable()) {
    throw new Error('浏览器不支持麦克风访问')
  }

  return navigator.mediaDevices.getUserMedia(constraints ?? { audio: true })
}

/**
 * 直接判断是否具备基础的麦克风访问能力，用于提前终止不必要的逻辑
 */
export const isMicrophoneSupported = (): boolean => isNavigatorMediaDevicesAvailable()
