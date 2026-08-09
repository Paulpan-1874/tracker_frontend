import { formatLastSeen, formatVbat } from '../utils'

// 右上角定位信息: 状态 + 用时 (未定位/未响应时用时显示 "—")
function locInfo(d) {
  if (d.locating) return { key: 'locating', text: '定位中…', dur: null }
  const loc = d.location
  if (loc && loc.status === 'ok') return { key: 'ok', text: '定位成功', dur: loc.duration }
  if (loc && loc.status === 'failed') return { key: 'failed', text: '定位失败', dur: loc.duration }
  if (d.noResponse) return { key: 'noresp', text: '未响应', dur: null }
  return { key: 'none', text: '未定位', dur: null }
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
        const loc = locInfo(d)
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
            // 整个格子就是指示灯: 在线描绿边微光, 离线黯淡
            className={`device-tile ${d.online ? 'tile-on' : 'tile-off'}`}
            onClick={() => onSelect(d.imei)}
            title={tip}
          >
            <div className="tile-top">
              {/* 左上: IMEI(自适应截断, 后期支持自定义设备名) */}
              <span className="tile-imei">{d.imei}</span>
              {/* 右上: 电量在顶, 下面卫星天线图标 + 定位状态/用时两行 */}
              <div className="tile-right">
                {t.vbat != null && <span className="tile-vbat">{formatVbat(t.vbat)}</span>}
                <div className={`tile-loc tile-state-${loc.key}`}>
                  <span className="tile-loc-icon">📡</span>
                  <span className="tile-loc-info">
                    <span className="tile-state">{loc.text}</span>
                    <span className="tile-dur">{loc.dur != null ? `${loc.dur}秒` : '—'}</span>
                  </span>
                </div>
              </div>
            </div>
            {/* 底部: 最近上报 */}
            <div className="tile-foot">{formatLastSeen(d.lastSeen)}</div>
          </li>
        )
      })}
    </ul>
  )
}
