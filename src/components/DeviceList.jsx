import { formatLastSeen, formatVbat } from '../utils'

// 小方格状态优先级: 定位中 > 定位结果 > 未响应 > 在线/离线
// 一台设备一个格子, 设备多时一屏扫完; 电压/最近收到放进悬停提示
function tileStatus(d) {
  if (d.locating) return { key: 'locating', text: '定位中…' }
  if (d.location && d.location.status === 'ok') return { key: 'ok', text: '定位成功' }
  if (d.location && d.location.status === 'failed') return { key: 'failed', text: '定位失败' }
  if (d.noResponse) return { key: 'noresp', text: '未响应' }
  return d.online ? { key: 'online', text: '在线' } : { key: 'offline', text: '离线' }
}

export default function DeviceList({ devices, onSelect }) {
  if (!devices.length) {
    return (
      <div className="empty">
        <div className="empty-icon">📡</div>
        <p>暂无设备上报</p>
        <p className="empty-hint">等待设备连接到 Broker…</p>
      </div>
    )
  }

  return (
    <ul className="device-grid">
      {devices.map((d) => {
        const s = tileStatus(d)
        const t = d.telemetry || {}
        const tip = [
          d.imei,
          d.online ? '在线' : '离线',
          t.vbat != null ? formatVbat(t.vbat) : null,
          formatLastSeen(d.lastSeen)
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <li
            key={d.imei}
            // 离线格子整体调暗 (定位中除外): 亮度 = 在线轴, 文案 = 状态轴
            className={`device-tile tile-${s.key} ${!d.online && s.key !== 'locating' ? 'tile-off' : ''}`}
            onClick={() => onSelect(d.imei)}
            title={tip}
          >
            <span className="tile-imei">{d.imei}</span>
            <span className={`tile-status tile-status-${s.key}`}>
              <i className="tile-dot" />
              {s.text}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
