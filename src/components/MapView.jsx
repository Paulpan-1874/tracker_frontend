import { useEffect, useRef, useState } from 'react'
import { AMAP_KEY } from '../config'

// 动态加载高德 JS API (单例缓存, 避免重复插入 script)
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

// 高德地图: 展示设备最新定位 (传入的经纬度须已纠偏为 GCJ-02)
export default function MapView({ lat, lng, title = '设备位置', zoom = 16 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadAMap()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return
        if (!mapRef.current) {
          mapRef.current = new AMap.Map(containerRef.current, {
            zoom,
            center: [lng, lat],
            resizeEnable: true
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
  }, [lat, lng, zoom, title])

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
  return <div ref={containerRef} className="map-view" />
}
