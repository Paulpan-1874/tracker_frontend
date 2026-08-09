import { formatLastSeen, formatVbat } from '../utils'

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
    <ul className="device-list">
      {devices.map((d) => {
        const t = d.telemetry || {}
        return (
          <li
            key={d.imei}
            className={`device-card ${d.online ? 'online' : 'offline'}`}
            onClick={() => onSelect(d.imei)}
          >
            <div className="device-top">
              <span className="imei">{d.imei}</span>
              <span className={`badge ${d.online ? 'badge-online' : 'badge-offline'}`}>
                {d.online ? '在线' : '离线'}
              </span>
            </div>
            <div className="device-meta">
              {t.rssi != null && <span className="chip">信号 {t.rssi}</span>}
              {t.vbat != null && <span className="chip">{formatVbat(t.vbat)}</span>}
              <span className="chip">{formatLastSeen(d.lastSeen)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
