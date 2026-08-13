import { useEffect, useRef, useState } from 'react'
import { AMAP_KEY } from '../config'

// 动态加载高德 JS API (与 MapView 共享单例缓存)
let amapPromise = null
function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (!amapPromise) {
    amapPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      // v1.4.x 只需 key, 无需 securityJsCode
      s.src = `https://webapi.amap.com/maps?v=1.4.17&key=${AMAP_KEY}`
      s.onload = () => resolve(window.AMap)
      s.onerror = () => {
        amapPromise = null
        reject(new Error('AMap load failed'))
      }
      document.head.appendChild(s)
    })
  }
  return amapPromise
}

// 无定位数据时的默认视野 (首个设备的历史定位点)
const DEFAULT_CENTER = [112.4483, 23.066]

// 多设备总览地图: points = [{ imei, lat, lng }] (经纬度须已纠偏为 GCJ-02)
// 空数组时展示默认地图; 新定位到达时增量点亮对应标记并自动框选视野
// satellite 由外部 (App) 控制, 切换按钮已移到顶部面板内
export default function FleetMap({ points, satellite }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({}) // imei -> AMap.Marker
  const satelliteRef = useRef(satellite) // 图层模式 (ref 供地图初始化读取)
  const [loadError, setLoadError] = useState(false)
  const [layerEpoch, setLayerEpoch] = useState(0) // 图层切换时递增, 触发地图重建

  useEffect(() => {
    let cancelled = false
    loadAMap()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return
        if (!mapRef.current) {
          const center = points.length > 0 ? [points[0].lng, points[0].lat] : DEFAULT_CENTER
          mapRef.current = new AMap.Map(containerRef.current, {
            zoom: 13,
            center,
            resizeEnable: true,
            // 性能优化配置
            scrollEnable: true,           // 启用滚轮缩放
            dragEnable: true,             // 启用拖拽
            moveAnim: false,              // 地图平移动画关闭（提升滑动响应速度）
            zoomAnim: false,              // 缩放动画关闭（提升缩放响应速度）
            // 地图层级配置：卫星模式下叠加路网保证路名可见
            layers: satelliteRef.current
              ? [
                  // 高清卫星图层：支持最大 20 级缩放（原默认只到 16-18 级）
                  new AMap.TileLayer({
                    zIndex: 1,
                    minZoom: 3,
                    maxZoom: 20,
                    urlTemplate: 'https://webst0{1-4}.is.autonavi.com/appmaptile/satellite/zoom/{z}/x/{x}/y/{y}.png',
                    size: [256, 256],
                    stylePrefix: 'webst',
                  }),
                  new AMap.TileLayer.RoadNet()
                ]
              : [new AMap.TileLayer()]
          })
            
          // 注册高性能监听器（提前加载周边瓦片）
          mapRef.current.plugin(['AMap.Scale', 'AMap.Geocoder'], () => {
            // 地图拖动时的事件监听
            mapRef.current.on('dragstart', function(e) {
              // 拖动开始前，可以提前请求周边区域的瓦片
              // 高德会自动处理预加载，但我们可以通过调整视野来提高流畅度
            })
              
            mapRef.current.on('zoomend', () => {
              // 缩放完成后立即设置合适的缩放级别范围
              mapRef.current.setMapLevel(4) // 限制最小缩放级别，避免过度放大导致瓦片过多
            })
          })
        }
        // 确保 MoveAnimation 插件已加载（单独处理）
        mapRef.current.plugin(['AMap.MoveAnimation'], () => {
          // Marker 动画相关代码已经在下方执行
        })
        
        // 增量同步标记：每个 imei 只保留最新位置
        const markers = markersRef.current
        const seen = new Set()
        points.forEach((p) => {
          seen.add(p.imei)
          const pos = [p.lng, p.lat]
          const marker = markers[p.imei]
          if (marker) {
            // 位置更新: 有动画插件则平滑移动, 否则直接跳转
            if (marker.moveTo) {
              marker.moveTo(pos, { duration: 500 })
            } else {
              marker.setPosition(pos)
            }
          } else {
            // 新定位点: 插件已加载则先建在偏南位置再 moveTo 回正, 形成"飞入"入场动画
            const pluginReady = !!AMap.MoveAnimation
            const m = new AMap.Marker({
              map: mapRef.current,
              position: pluginReady ? [pos[0], pos[1] - 0.008] : pos,
              title: `设备 ${p.imei}`
            })
            if (pluginReady) m.moveTo(pos, { duration: 600 })
            markers[p.imei] = m
          }
        })
        // 清理已不存在的点 (设备换了新定位不会重复, 仅防御性处理)
        Object.keys(markers).forEach((imei) => {
          if (!seen.has(imei)) {
            mapRef.current.remove(markers[imei])
            delete markers[imei]
          }
        })
        // 视野自适应：单点用适中 padding(避免过度贴近)，多点框选全部
        if (points.length === 1) {
          // 单点时设置较大 padding，让地图有舒适的视角范围，不会过于贴近
          mapRef.current.setFitView(Object.values(markers), false, [100, 100, 100, 100])
        } else if (points.length > 1) {
          // 多点时用较小 padding，保证所有设备都在视野内且显示充分
          mapRef.current.setFitView(Object.values(markers), false, [80, 80, 80, 80])
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [points, layerEpoch])

  // 卫星图/普通图切换: 销毁重建地图实例, 用初始化 layers 参数选择图层组合
  // (AMap v1.4 的 addLayer 动态叠加存在兼容坑, 重建最稳; 标记会随 points effect 自动重建)
  useEffect(() => {
    satelliteRef.current = satellite
    if (mapRef.current) {
      mapRef.current.destroy()
      mapRef.current = null
      markersRef.current = {}
      setLayerEpoch((e) => e + 1)
    }
  }, [satellite])

  // 组件卸载时销毁地图实例
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
        markersRef.current = {}
      }
    }
  }, [])

  if (loadError) {
    return <div className="map-error">地图加载失败，请检查网络或 key 配置</div>
  }
  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-view" />
    </div>
  )
}
