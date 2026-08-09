import { useEffect, useState } from 'react'
import { useMqtt } from './hooks/useMqtt'
import DeviceList from './components/DeviceList.jsx'
import DeviceDetail from './components/DeviceDetail.jsx'
import Login from './components/Login.jsx'
import { getAuth, logout, fetchMyDevices } from './api'

// 登录后的控制台: 只显示当前用户名下的设备
function Console({ auth, onLogout }) {
  const { status, devices, sendCommand, sendBroadcast, clearBroadcast } = useMqtt()
  const [selected, setSelected] = useState(null)
  const [ownedImeis, setOwnedImeis] = useState(null) // null=加载中, []=无设备
  const [loadError, setLoadError] = useState('')
  const [broadcastTip, setBroadcastTip] = useState('')

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
  const list = (ownedImeis || [])
    .map((imei) => devices[imei] || { imei, online: false, lastSeen: 0 })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return b.lastSeen - a.lastSeen
    })

  const current = selected ? list.find((d) => d.imei === selected) : null
  const onlineCount = list.filter((d) => d.online).length

  // 一键定位: 广播 gps_start (retained), 设备上线即执行, 逐台回传定位
  const doBroadcastGps = () => {
    if (sendBroadcast(auth.user.id, 'gps_start')) {
      setBroadcastTip(`广播已下发，${list.length} 台设备上线后将自动定位上报`)
    } else {
      setBroadcastTip('下发失败，请确认已连接 Broker')
    }
  }

  const doClearBroadcast = () => {
    if (clearBroadcast(auth.user.id)) {
      setBroadcastTip('广播已撤回，后续上线的设备不再执行')
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
          <button className="broadcast-btn" onClick={doBroadcastGps} disabled={status !== 'connected'}>
            📍 一键定位所有设备
          </button>
          <button className="broadcast-btn ghost" onClick={doClearBroadcast} disabled={status !== 'connected'}>
            撤回广播
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
        <DeviceList devices={list} onSelect={setSelected} />
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
