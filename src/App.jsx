import { useEffect, useRef, useState } from 'react'
import { useMqtt } from './hooks/useMqtt'
import DeviceList from './components/DeviceList.jsx'
import DeviceDetail from './components/DeviceDetail.jsx'
import FleetMap from './components/FleetMap.jsx'
import Login from './components/Login.jsx'
import { getAuth, logout, fetchMyDevices } from './api'
import { wgs84ToGcj02, locStatusOf } from './utils'

// 登录后的控制台: 只显示当前用户名下的设备
function Console({ auth, onLogout }) {
  const { status, devices, sendCommand, sendBroadcast, clearBroadcast, broadcast } = useMqtt(auth.user.id)
  const [selected, setSelected] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false) // 面板底部抓手展开的设备抽屉
  const [satellite, setSatellite] = useState(false) // 总览地图图层模式 (按钮在顶部面板内)
  const swipeY = useRef(null) // 抽屉手势: 记录起始触点, 下滑展开/上滑收起
  const justSwiped = useRef(false) // 手势触发后吞掉随后的 click, 避免抽屉被立刻弹回
  const [ownedImeis, setOwnedImeis] = useState(null) // null=加载中, []=无设备
  const [loadError, setLoadError] = useState('')

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

  // 有设备处于有效搜星中时每秒重渲染: 让 locStatusOf 的超时兜底及时把残留 locating 翻转为失败
  // (灯阵没有消息驱动时, 不 tick 就会卡在黄灯呼吸)
  const anyLocating = list.some((d) => locStatusOf(d) === 'locating')
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!anyLocating) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [anyLocating])

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
      clearBroadcast(auth.user.id, ownedImeis || [])
    } else {
      sendBroadcast(auth.user.id, 'gps_start')
    }
  }

  return (
    // 全屏布局: 地图铺满整个视口, 操作面板/详情页作为左侧悬浮抽屉
    <div className="app app-full">
      <div className="map-area">
        <FleetMap points={gpsPoints} satellite={satellite} />
      </div>

      {/* 浮动控制面板: 菜单行 + 定位状态灯阵 (3行×30列) + 底部抽屏抓手 */}
      <header className="topbar topbar-merged">
        <div className="topbar-row">
          <div className="topbar-title">
            <h1>设备控制台</h1>
            <p className="sub">
              {auth.user.name} · 共 {list.length} 台设备，在线 {onlineCount} 台
            </p>
          </div>
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
        {/* 详情打开时控制面板收回单行; 灯阵/按钮/抽屉仅在总览态显示 */}
        {!current && (
          <>
            {/* 灯阵概览设备状态 (在线蓝灯常亮, 定位中黄灯呼吸, 成功绿灯常亮, 失败红灯常亮, 离线不亮) */}
            <div className="panel-lamps">
              {/* 固定 90 个坑位 (3行×30列): 设备占前 N 格, 多余坑位保留灯框 */}
              {Array.from({ length: Math.max(list.length, 90) }).map((_, i) => {
                const d = list[i]
                if (!d) return <span key={`slot-${i}`} className="panel-lamp slot" />
                // 定位状态走 locStatusOf 权威判定: 离线/超时的残留 locating 判为失败, 不会永远黄灯呼吸
                const locStatus = locStatusOf(d)
                const cls =
                  locStatus === 'ok'
                    ? 'lamp-on'
                    : locStatus === 'locating'
                      ? 'lamp-on lamp-breathe'
                      : locStatus === 'failed'
                        ? 'lamp-on lamp-fail'
                        : d.online
                          ? 'lamp-on lamp-online'
                          : ''
                const text =
                  locStatus === 'ok'
                    ? '定位成功'
                    : locStatus === 'locating'
                      ? '定位中'
                      : locStatus === 'failed'
                        ? '定位失败'
                        : d.online
                          ? '在线'
                          : '离线'
                return (
                  <button
                    key={d.imei}
                    className={`panel-lamp ${cls}`}
                    title={`${d.imei} · ${text}`}
                    onClick={() => {
                      setDrawerOpen(false)
                      setSelected(d.imei)
                    }}
                  />
                )
              })}
            </div>
            {/* 设备抽屉: 高度固定, 设备卡片一行四个, 可滑动; 上滑可收起 */}
            {drawerOpen && (
              <div
                className="device-drawer"
                onTouchStart={(e) => (swipeY.current = e.touches[0].clientY)}
                onTouchMove={(e) => {
                  if (swipeY.current == null) return
                  if (swipeY.current - e.touches[0].clientY > 40) {
                    setDrawerOpen(false)
                    swipeY.current = null
                    justSwiped.current = true
                  }
                }}
              >
                {loadError && <div className="cmd-result fail">{loadError}</div>}
                {ownedImeis === null ? (
                  <div className="empty">
                    <div className="empty-icon">⏳</div>
                    <p>正在加载设备列表…</p>
                  </div>
                ) : (
                  <DeviceList
                    devices={list}
                    onSelect={(imei) => {
                      setDrawerOpen(false)
                      setSelected(imei)
                    }}
                  />
                )}
              </div>
            )}
            {/* 底部抽屏抓手: 点按或下滑展开 (底部抽屉风格, 弱化成一条窄边减少误触面积) */}
            <button
              className="drawer-grip"
              onClick={() => {
                if (justSwiped.current) {
                  justSwiped.current = false
                  return
                }
                setDrawerOpen(!drawerOpen)
              }}
              onTouchStart={(e) => (swipeY.current = e.touches[0].clientY)}
              onTouchMove={(e) => {
                if (swipeY.current == null) return
                const dy = e.touches[0].clientY - swipeY.current
                if (dy > 30 && !drawerOpen) {
                  setDrawerOpen(true)
                  swipeY.current = null
                  justSwiped.current = true
                } else if (dy < -30 && drawerOpen) {
                  setDrawerOpen(false)
                  swipeY.current = null
                  justSwiped.current = true
                }
              }}
            >
              <span className="grip-pill" />
            </button>
          </>
        )}
        {/* 图层切换: 脱离面板卡片, 悬浮在面板正下方靠右 (DOM 在 header 内, 高度变化时自动跟随) */}
        <button className="map-layer-btn" onClick={() => setSatellite(!satellite)}>
          {satellite ? '普通图' : '卫星图'}
        </button>
      </header>

      {/* 页面底部悬浮操作栏: 一键定位按钮 (独立于顶部面板, 随时可触达) */}
      <button
        className={`broadcast-btn full bottom ${broadcastActive ? 'lit' : ''}`}
        onClick={toggleBroadcast}
        disabled={status !== 'connected'}
      >
        {broadcastActive ? (
          <>
            等待设备上线，再次点击可取消
            <span className="btn-spinner" />
          </>
        ) : (
          '开始定位'
        )}
      </button>

      {/* 设备详情: 沿用左侧悬浮抽屉, 返回后重新展开设备抽屉 */}
      {current && (
        <aside className="panel">
          <DeviceDetail
            device={current}
            onBack={() => {
              setSelected(null)
              setDrawerOpen(true)
            }}
            sendCommand={sendCommand}
          />
        </aside>
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
