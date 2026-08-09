// ====== EMQX 连接配置 ======
// 浏览器直连 EMQX 的 WebSocket 监听器 (默认 8083, 路径 /mqtt)
// 请确认 EMQX 已开启 WebSocket 监听, 且服务器防火墙放行 8083 端口
export const MQTT_URL = 'ws://149.88.75.117:8083/mqtt'

// ====== PocketBase (登录 + 设备归属) ======
export const PB_URL = 'http://149.88.75.117:8091'

// ====== 主题约定 (与 v2 固件一致) ======
// 设备上报: device/{imei}/data   下发指令: device/{imei}/cmd   在线状态: device/{imei}/status
// 最后位置: device/{imei}/location (retained, 定位成功时覆盖更新, 刷新页面仍可展示)
// 用户广播: user/{userId}/cmd_broadcast (retained, 设备上线即收到, 支持一键指挥所有设备)
export const DATA_TOPIC = 'device/+/data'
export const STATUS_TOPIC = 'device/+/status'
export const LOCATION_TOPIC = 'device/+/location'
export const cmdTopic = (imei) => `device/${imei}/cmd`
export const broadcastTopic = (userId) => `user/${userId}/cmd_broadcast`

// ====== 在线判定 ======
// 主要依据 device/+/status 的 retained 消息 (online/offline)。
// 对仅有 data 上报、没有 status 的设备, 超过该时长无上报则判定离线 (兜底)
export const ONLINE_TIMEOUT_MS = 120 * 1000

// ====== 高德地图 ======
// Web端(JS API) key; 设备上报为 WGS-84 坐标, 高德使用 GCJ-02, 前端本地纠偏
export const AMAP_KEY = '21393e2199d124ac360f511c3a1b5d3f'

// ====== 快捷指令 (action 字段, 与固件指令协议一致) ======
export const COMMANDS = [
  { action: 'status', label: '查询状态' },
  { action: 'gps_start', label: 'GPS 定位' },
  { action: 'reboot', label: '重启设备' }
]
