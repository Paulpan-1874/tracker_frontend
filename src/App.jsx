import { useEffect, useState } from 'react'
import { useMqtt } from './hooks/useMqtt'
import DeviceList from './components/DeviceList.jsx'
import DeviceDetail from './components/DeviceDetail.jsx'
import FleetMap from './components/FleetMap.jsx'
import Login from './components/Login.jsx'
import { getAuth, logout, fetchMyDevices } from './api'
import { wgs84ToGcj02 } from './utils'

// 登录后的控制台: 只显示当前用户名下的设备
function Console({ auth, onLogout }) {
  const { status, devices, sendCommand, sendBroadcast, clearBroadcast, broadcast } = useMqtt(auth.user.id)
  const [selected, setSelected] = useState(null)
  const [ownedImeis, setOwnedImeis] = useState(null) // null=加载中, []=无设备
  const [loadError, setLoadError] = useState('')
  const [broadcastTip, setBroadcastTip] = useState('')

  // 广播按钮状态 = Broker retained 实况 (broadcast 由订阅同步), 不存在假广播
  const broadcastActive = !!(broadcast && broadcast.action)

  // 按用户 id 拉取名下设备
  useEffect(() => {
    let cancelled = false
    fetchMyDevices(auth.token, auth.user.id)
      .then((imeis) => {
        if (!cancelled) setOwnedImeis(imeis)
      })
      .catch((err) => {
        if (cancelled) return
        if (err.message === 'unauthorized') {
          logout()
          onLogout()
        } else {
          setLoadError('设备列表加载失败，请重试')
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth.token, auth.user.id, onLogout])

  // 名下 IMEI 与 MQTT 实时数据合并: 无上报记录的设备显示为离线占位
  // 广播期间追加 noResponse 标记: 本次广播后从未写过 location (时间戳早于广播) = 未响应 (可能没电)
  const broadcastTime = broadcastActive ? broadcast.time || '' : ''
  const list = (ownedImeis || [])
    .map((imei) => devices[imei] || { imei, online: false, lastSeen: 0 })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return b.lastSeen - a.lastSeen
    })
    .map((d) =>
      broadcastActive
        ? { ...d, noResponse: !d.location || (d.location.time || '') < broadcastTime }
        : d
    )

  const current = selected ? list.find((d) => d.imei === selected) : null
  const onlineCount = list.filter((d) => d.online).length

  // 汇总名下所有设备的最后位置 (唯一来源: retained location, WGS-84 → GCJ-02)
  const gpsPoints = list
    .map((d) => {
      const e = d.location
      if (!e || e.lat == null || e.lng == null) return null
      const g = wgs84ToGcj02(e.lat, e.lng)
      return { imei: d.imei, lat: g.lat, lng: g.lng }
    })
    .filter(Boolean)

  // 一键定位开关: 点亮=下发 retained 广播; 再点=撤回广播并清空名下所有设备的 retained 位置
  const toggleBroadcast = () => {
    if (broadcastActive) {
      if (clearBroadcast(auth.user.id, ownedImeis || [])) {
        setBroadcastTip('广播已撤回，定位信息已清空')
      }
    } else if (sendBroadcast(auth.user.id, 'gps_start')) {
      setBroadcastTip(`广播已下发，${list.length} 台设备上线后将自动定位上报`)
    } else {
      setBroadcastTip('下发失败，请确认已连接 Broker')
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>设备控制台</h1>
          <p className="sub">
            {auth.user.name} · {onlineCount} 台在线 · 共 {list.length} 台
          </p>
        </div>
        <div className="header-right">
          <span className={`conn conn-${status}`}>
            {status === 'connected' ? '已连接' : status === 'connecting' ? '连接中…' : '连接失败'}
          </span>
          <button
            className="logout-btn"
            onClick={() => {
              logout()
              onLogout()
            }}
          >
            退出
          </button>
        </div>
      </header>

      {loadError && <div className="cmd-result fail">{loadError}</div>}

      {!current && (
        <div className="broadcast-bar">
          <button
            className={`broadcast-btn ${broadcastActive ? 'lit' : ''}`}
            onClick={toggleBroadcast}
            disabled={status !== 'connected'}
          >
            {broadcastActive ? '● 定位广播已开启，点击撤回' : '📍 一键定位所有设备'}
          </button>
          {broadcastTip && <span className="broadcast-tip">{broadcastTip}</span>}
        </div>
      )}

      {ownedImeis === null ? (
        <div className="empty">
          <div className="empty-icon">⏳</div>
          <p>正在加载设备列表…</p>
        </div>
      ) : current ? (
        <DeviceDetail device={current} onBack={() => setSelected(null)} sendCommand={sendCommand} />
      ) : (
        <>
          <DeviceList devices={list} onSelect={setSelected} />
          <section className="card">
            <h3>
              最近定位{' '}
              {gpsPoints.length > 0 ? `(${gpsPoints.length}/${list.length} 台)` : '(等待定位上报)'}
            </h3>
            <FleetMap points={gpsPoints} />
          </section>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [auth, setAuth] = useState(getAuth())

  if (!auth) {
    return <Login onLogin={setAuth} />
  }
  return <Console auth={auth} onLogout={() => setAuth(null)} />
}
