// 把时间戳格式化为「刚刚 / x秒前 / x分钟前 / x小时前」
export function formatLastSeen(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 5000) return '刚刚'
  if (diff < 60000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return new Date(ts).toLocaleString()
}

// 电压 mV -> 友好显示
export function formatVbat(mv) {
  if (mv == null) return undefined
  const num = Number(mv)
  if (Number.isNaN(num)) return mv
  return num > 1000 ? `${(num / 1000).toFixed(2)} V` : `${num} mV`
}

// mV -> 电量百分比: 与固件 battery.level() 同规则 (3400mV=空, 4200mV=满)
// 仅作过渡回退: 旧固件消息只带 vbat 没有 batt 字段, 设备 FOTA 升级完成后即可移除
export function toBattPct(mv) {
  const num = Number(mv)
  if (Number.isNaN(num)) return null
  return Math.round(Math.min(1, Math.max(0, (num - 3400) / 800)) * 100)
}

// ====== 定位状态权威判定 ======
// retained locating 只是过程态: 设备搜星途中断电/失联时, ok/failed 永远不会写入,
// 前端不做兜底就会永远卡在"定位中"跑表。
// 判定只看 MQTT 消息流, 不看设备时间戳 (两端时钟可能不同步), 全部基于本地到达时间:
// ① 设备离线 (休眠/断电不可能在搜星) → 立即判失败
// ② 新固件 (locating 带 timeout 字段): 搜星期间每 10 秒有 gps_searching 心跳,
//    超过 30 秒没收到该设备任何消息 → 搜星已中断, 判失败
// ③ 旧固件 (无心跳): 回退固定超时, 从 locating 本地到达时间起算 (FOTA 全覆盖后可删)
const SIGNAL_STALE_MS = 30000
const LOCATING_FALLBACK_MS = 180000
export function locStatusOf(d, now = Date.now()) {
  const loc = d.location
  if (!loc || !loc.status) return null
  if (loc.status !== 'locating') return loc.status
  if (!d.online) return 'failed'
  const signalAt = d.lastMsgAt || loc.receivedAt
  if (loc.timeout != null) {
    if (signalAt && now - signalAt > SIGNAL_STALE_MS) return 'failed'
  } else if (!signalAt || now - signalAt > LOCATING_FALLBACK_MS) {
    return 'failed'
  }
  return 'locating'
}

// ====== WGS-84 -> GCJ-02 坐标系纠偏 ======
// GPS 原始坐标是 WGS-84, 高德/腾讯使用国测局 GCJ-02 (火星坐标系),
// 不纠偏会有几百米偏差。以下为标准的本地换算算法, 无需调接口。
const GCJ_A = 6378245.0 // 长半轴
const GCJ_EE = 0.00669342162296594323 // 偏心率平方

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3
  return r
}

function transformLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3
  return r
}

// WGS-84 转 GCJ-02, 返回 { lat, lng }; 境外坐标不做偏移
export function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng }
  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const radLat = (lat / 180) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { lat: lat + dLat, lng: lng + dLng }
}
