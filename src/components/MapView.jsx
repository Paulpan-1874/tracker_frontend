import { useEffect, useRef, useState } from 'react'
import { AMAP_KEY } from '../config'

// 安全密钥：2021-12-02 后申请的 key 必须配置，需在加载脚本前设置
if (!window._AMapSecurityConfig) {
  window._AMapSecurityConfig = {
    securityJsCode: 'd7f9c8cc45453eed7a4a4e0bd7643b03'
  }
}

// 动态加载高德 JS API (单例缓存, 避免重复插入 script)
let amapPromise = null
function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (!amapPromise) {
    amapPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      // v1.4.x + 安全密钥 (_AMapSecurityConfig) 组合
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

// 坐标安全校验
function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
}

// 高德地图: 展示设备最新定位 (传入的经纬度须已纠偏为 GCJ-02)
export default function MapView({ lat, lng, title = '设备位置', zoom = 16 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const satelliteRef = useRef(false) // 图层模式 (ref 供地图初始化读取, state 驱动按钮文案)
  const [loadError, setLoadError] = useState(false)
  const [satellite, setSatellite] = useState(false)
  const [layerEpoch, setLayerEpoch] = useState(0) // 图层切换时递增, 触发地图重建

  useEffect(() => {
    let cancelled = false
    loadAMap()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return
        if (!validCoord(lat, lng)) {
          console.warn('[MapView] 无效坐标, 跳过:', lat, lng)
          return
        }
        if (!mapRef.current) {
          mapRef.current = new AMap.Map(containerRef.current, {
            zoom,
            center: [lng, lat],
            maxZoom: 19, // 实测卫星瓦片真实最高 z19
            resizeEnable: true,
            // 初始化时直接指定图层组合: 卫星模式下叠加路网保证路名可见
            layers: satelliteRef.current
              ? [new AMap.TileLayer.Satellite(), new AMap.TileLayer.RoadNet()]
              : [new AMap.TileLayer()]
          })
          markerRef.current = new AMap.Marker({
            map: mapRef.current,
            position: [lng, lat],
            title
          })
        } else {
          mapRef.current.setZoomAndCenter(zoom, [lng, lat])
          markerRef.current.setPosition([lng, lat])
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [lat, lng, zoom, title, layerEpoch])

  // 卫星图/普通图切换: 销毁重建地图实例, 用初始化 layers 参数选择图层组合
  // (AMap v1.4 的 addLayer 动态叠加存在兼容坑, 重建最稳)
  const toggleSatellite = () => {
    if (!mapRef.current) return
    mapRef.current.destroy()
    mapRef.current = null
    markerRef.current = null
    satelliteRef.current = !satellite
    setSatellite(!satellite)
    setLayerEpoch((e) => e + 1)
  }

  // 组件卸载时销毁地图实例, 释放内存
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
        markerRef.current = null
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
