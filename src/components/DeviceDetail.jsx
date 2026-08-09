import { useState } from 'react'
import { COMMANDS } from '../config'
import { formatLastSeen, formatVbat, wgs84ToGcj02 } from '../utils'
import MapView from './MapView.jsx'

function Row({ k, v }) {
  if (v == null || v === '') return null
  return (
    <div className="kv-row">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  )
}

export default function DeviceDetail({ device, onBack, sendCommand }) {
  const [customAction, setCustomAction] = useState('')
  const [lastCmd, setLastCmd] = useState(null)
  const t = device.telemetry || {}

  // 最后定位结果 (唯一来源: retained location): 成功带坐标, 失败带 reason
  const loc = device.location
  const gpsFailed = loc && loc.status === 'failed'
  const gpsRaw = !gpsFailed && loc && loc.lat != null ? loc : null
  const gps = gpsRaw ? { ...gpsRaw, ...wgs84ToGcj02(gpsRaw.lat, gpsRaw.lng) } : null

  const handleSend = (action) => {
    const ok = sendCommand(device.imei, action)
    setLastCmd({
      action: typeof action === 'string' ? action : JSON.stringify(action),
      ok,
      time: new Date().toLocaleTimeString()
    })
  }

  return (
    <div className="detail">
      <button className="back" onClick={onBack}>← 返回列表</button>

      <div className="detail-head">
        <h2>{device.imei}</h2>
        {device.locating && <span className="badge badge-locating">定位中…</span>}
        <span className={`badge ${device.online ? 'badge-online' : 'badge-offline'}`}>
          {device.online ? '在线' : '离线'}
        </span>
      </div>

      <section className="card">
        <h3>最新状态</h3>
        <Row k="信号 RSSI" v={t.rssi} />
        <Row k="信号 CSQ" v={t.csq} />
        <Row k="电池电压" v={formatVbat(t.vbat)} />
        <Row k="ICCID" v={t.iccid} />
        <Row k="运行时长" v={t.uptime != null ? `${t.uptime} 秒` : undefined} />
        <Row k="上报时间" v={t.time} />
        <Row k="最近收到" v={formatLastSeen(device.lastSeen)} />
      </section>

      <section className="card">
        <h3>发送指令</h3>
        <div className="cmd-buttons">
          {COMMANDS.map((c) => (
            <button key={c.action} className="cmd-btn" onClick={() => handleSend(c.action)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="custom-cmd">
          <input
            placeholder="自定义 action"
            value={customAction}
            onChange={(e) => setCustomAction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && customAction && handleSend(customAction.trim())}
          />
          <button onClick={() => customAction.trim() && handleSend(customAction.trim())}>发送</button>
        </div>
        {lastCmd && (
          <div className={`cmd-result ${lastCmd.ok ? 'ok' : 'fail'}`}>
            {lastCmd.time} · {lastCmd.action} · {lastCmd.ok ? '已发送' : '发送失败(未连接)'}
          </div>
        )}
        {!device.online && (
          <div className="cmd-result warn">设备当前离线，指令可能无法送达</div>
        )}
      </section>

      {gps && (
        <section className="card">
          <h3>最近定位</h3>
          <MapView lat={gps.lat} lng={gps.lng} title={`设备 ${device.imei}`} />
          <Row k="坐标 (GCJ-02)" v={`${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`} />
          <Row k="卫星数" v={gps.sats} />
          <div className="map-link-row">
            <a
              className="map-link"
              href={`https://uri.amap.com/marker?position=${gps.lng.toFixed(6)},${gps.lat.toFixed(6)}&name=设备${device.imei}`}
              target="_blank"
              rel="noreferrer"
            >
              在高德地图中打开
            </a>
          </div>
        </section>
      )}

      {gpsFailed && (
        <section className="card">
          <h3>最近定位</h3>
          <div className="cmd-result fail">
            最后一次定位失败（{loc.reason === 'timeout' ? '搜星超时' : loc.reason || '原因未知'}）· {loc.time || ''}
          </div>
        </section>
      )}

      <section className="card">
        <h3>最近上报 ({device.events?.length || 0})</h3>
        <ul className="events">
          {(device.events || []).slice().reverse().map((e, i) => (
            <li key={i}>
              <span className="ev-name">{e.event || 'data'}</span>
              <span className="ev-time">{e.time || ''}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
