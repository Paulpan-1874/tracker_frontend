import { formatLastSeen, formatVbat } from '../utils'

// 电池图标: 四格电, 颜色随总电量: 3-4格=绿, 2格=黄, 1格=红
// 电压映射: 3400mV=空 → 4200mV=满 (锂电工作区间)
function BatteryIcon({ mv }) {
  const pct = Math.min(1, Math.max(0, (mv - 3400) / 800))
  const lit = Math.round(pct * 4)
  const color = lit >= 3 ? 'var(--green)' : lit === 2 ? '#fbbf24' : 'var(--red)'
  return (
    <svg className="batt" viewBox="0 0 22 11" width="20" height="10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="18.5" height="10" rx="2" fill="none" stroke="currentColor" />
      <rect x="19.8" y="3" width="1.7" height="5" rx="0.8" fill="currentColor" />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={2 + i * 4}
          y="2"
          width="3.2"
          height="7"
          rx="0.8"
          fill={i < lit ? color : 'rgba(148, 163, 184, 0.18)'}
        />
      ))}
    </svg>
  )
}

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
        // 电压优先取实时遥测; 设备休眠/页面刷新后无遥测时, 回退用 retained 位置里携带的 vbat
        const vbat = t.vbat != null ? t.vbat : d.location && d.location.vbat != null ? d.location.vbat : null
        const tip = [
          d.imei,
          d.online ? '在线' : '离线',
          vbat != null ? formatVbat(vbat) : null,
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
              {/* 第一行: IMEI(自适应截断) + 电池图标 */}
              <span className="tile-imei">{d.imei}</span>
              {vbat != null && (
                <span className="tile-vbat" title={formatVbat(vbat)}>
                  <BatteryIcon mv={vbat} />
                </span>
              )}
            </div>
            {/* 第二行: 卫星天线图标 + 定位状态/用时 */}
            <div className={`tile-loc tile-state-${loc.key}`}>
              <span className="tile-loc-icon">📡</span>
              <span className="tile-loc-info">
                <span className="tile-state">{loc.text}</span>
                <span className="tile-dur">{loc.dur != null ? `${loc.dur}秒` : '—'}</span>
              </span>
            </div>
            {/* 底部: 小指示灯 + 在线文字(左), 最近上报(右) */}
            <div className="tile-foot">
              <span className={`tile-lamp ${d.online ? 'lamp-on' : 'lamp-off'}`} />
              <span className="tile-net">{d.online ? '在线' : '离线'}</span>
              <span className="tile-time">{formatLastSeen(d.lastSeen)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
