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
export default function FleetMap({ points }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({}) // imei -> AMap.Marker
  const satelliteRef = useRef(false) // 图层模式 (ref 供地图初始化读取, state 驱动按钮文案)
  const [loadError, setLoadError] = useState(false)
  const [satellite, setSatellite] = useState(false)
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
            // 初始化时直接指定图层组合: 卫星模式下叠加路网保证路名可见
            layers: satelliteRef.current
              ? [new AMap.TileLayer.Satellite(), new AMap.TileLayer.RoadNet()]
              : [new AMap.TileLayer()]
          })
        }
        // 增量同步标记: 每个 imei 只保留最新位置
        const markers = markersRef.current
        const seen = new Set()
        points.forEach((p) => {
          seen.add(p.imei)
          const pos = [p.lng, p.lat]
          if (markers[p.imei]) {
            markers[p.imei].setPosition(pos)
          } else {
            markers[p.imei] = new AMap.Marker({
              map: mapRef.current,
              position: pos,
              title: `设备 ${p.imei}`
            })
          }
        })
        // 清理已不存在的点 (设备换了新定位不会重复, 仅防御性处理)
        Object.keys(markers).forEach((imei) => {
          if (!seen.has(imei)) {
            mapRef.current.remove(markers[imei])
            delete markers[imei]
          }
        })
        // 视野自适应: 单点用适中缩放(避免过度放大), 多点框选全部
        if (points.length === 1) {
          mapRef.current.setZoomAndCenter(15, [points[0].lng, points[0].lat])
        } else if (points.length > 1) {
          mapRef.current.setFitView(Object.values(markers), false, [60, 60, 60, 60])
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
  const toggleSatellite = () => {
    if (!mapRef.current) return
    mapRef.current.destroy()
    mapRef.current = null
    markersRef.current = {}
    satelliteRef.current = !satellite
    setSatellite(!satellite)
    setLayerEpoch((e) => e + 1)
  }

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
      <button className="map-layer-btn" onClick={toggleSatellite}>
        {satellite ? '普通图' : '卫星图'}
      </button>
    </div>
  )
}
