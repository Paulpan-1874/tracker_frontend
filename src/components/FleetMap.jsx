import { useEffect, useRef, useState } from 'react'
import { AMAP_KEY } from '../config'

// 设置高德安全密钥（必须在加载地图脚本之前）
if (window._AMapSecurityConfig) {
  console.log('⚠️ AMapSecurityConfig already set')
} else {
  window._AMapSecurityConfig = {
    securityJsCode: 'd7f9c8cc45453eed7a4a4e0bd7643b03'
  }
  console.log('✅ Security config set')
}

// 动态加载高德 JS API (与 MapView 共享单例缓存)
let amapPromise = null
function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (!amapPromise) {
    amapPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      // v1.4.x + 安全密钥 (_AMapSecurityConfig) 组合，2021-12-02 后申请的 key 必须配置
      script.src = `https://webapi.amap.com/maps?v=1.4.17&key=${AMAP_KEY}`
      script.async = true
      
      // 在脚本加载前注入自定义样式，清除 label 的白色背景和边框
      const style = document.createElement('style')
      style.textContent = `
        .amap-marker-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
      `
      document.head.appendChild(style)
      
      script.onload = () => {
        console.log('✅ AMap script loaded successfully')
        resolve(window.AMap)
      }
      
      script.onerror = () => {
        console.error('❌ Failed to load AMap script from:', script.src)
        reject(new Error('Failed to load AMap script'))
      }
      
      document.head.appendChild(script)
    })
  }
  return amapPromise
}

// 无定位数据时的默认视野 (首个设备的历史定位点)
const DEFAULT_CENTER = [112.4483, 23.066]

// v1.4 features 合法值: bg/point/road/building (v2.0 的 city/poi 在 v1.4 会被静默忽略)
const FEATURES_HIDDEN = ['bg', 'road', 'building']              // 隐藏地名/POI 标注
const FEATURES_SHOWN = ['bg', 'point', 'road', 'building']     // 显示全部标注

// 卫星模式标注图层: 官方 RoadNet (路网+地名合层)
// 说明: 纯标注方案 (style=7 瓦片 + Flexible/getTileUrl) 在 v1.4 下实测不稳定;
// RoadNet 会连同路线一起显示, 为当前可接受的方案。
// 实测结论 (test-labels.html 方案 D): 官方图层动态 add/remove 可用, 无需重建地图

// 坐标安全校验：拦截 NaN/Infinity/undefined，避免 AMap LngLat(NaN, NaN) 崩溃
function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
}

// 格式化定位时间为简短显示 (相对于当前时间)
function formatFixTime(t) {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d.getTime())) return ''
  
  const now = new Date()
  const diffMs = now - d
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  
  // 30 秒内显示秒，否则根据时长选择单位
  if (diffHours < 1) {
    if (diffMins < 1) {
      return `${diffSecs}s`
    } else {
      return `${diffMins}m`
    }
  } else {
    return `${diffHours}h`
  }
}

// 更新 marker 的文字标签内容
function updateMarkerLabel(marker, p, labelMode) {
  // labelMode === 0 时关闭标签
  if (labelMode === 0) {
    marker.setLabel({})
    return
  }
  
  // labelMode !== 0 时显示标签
  const label = p.name || p.imei
  let content = label
  
  // labelMode === 2 时添加时间
  if (labelMode === 2) {
    const time = formatFixTime(p.lastFix)
    if (time) {
      content = `${label} • ${time}`
    }
  }
  
  // 设置标签到 marker 上方
  marker.setLabel({
    offset: new AMap.Pixel(0, -18),
    content: `<div style="position: absolute; left: 50%; transform: translateX(-50%); top: 3px; background: #fff; color: #0f172a; border-radius: 4px; padding: 2px 6px; white-space: nowrap; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15); font-size: 9px; font-weight: 500;">${content}</div>`,
    direction: 'top'
  })
}

// 删除旧的 getShowLabels 函数


// 多设备总览地图：points = [{ imei, lat, lng }] (经纬度须已纠偏为 GCJ-02)
// 空数组时展示默认地图; 新定位到达时增量点亮对应标记并自动框选视野
// satellite 由外部 (App) 控制，切换按钮已移到顶部面板内
export default function FleetMap({ points, satellite, hiddenPOI = true, labelMode = 0 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({}) // imei -> AMap.Marker
  const satelliteRef = useRef(satellite) // 图层模式 (ref 供地图初始化读取)
  const hiddenPOIRef = useRef(hiddenPOI) // POI 显隐 (ref 供地图初始化读取)
  const labelModeRef = useRef(labelMode) // 标签显示模式：0=关闭，1=只显示名字，2=显示名字 + 时间
  const roadNetRef = useRef(null) // 卫星模式下的路网标注图层 (RoadNet: 地名 + 路线合层)
  const viewRef = useRef(null) // 图层切换重建前的视野 { center, zoom }, 重建后原样恢复
  const positionsRef = useRef({}) // imei -> "lat,lng" 上次已拉过视角的位置快照
  const [loadError, setLoadError] = useState(false)
  const [layerEpoch, setLayerEpoch] = useState(0) // 图层切换时递增，触发地图重建
  const timeUpdateIntervalRef = useRef(null) // 定时更新时间显示

  // 跟踪 labelMode 变化（不触发重绘）
  useEffect(() => {
    labelModeRef.current = labelMode
    // 立即刷新所有现有 marker 的标签状态
    const markers = markersRef.current
    for (const imei in markers) {
      const p = points.find(point => point.imei === imei)
      if (p) {
        updateMarkerLabel(markers[imei], p, labelMode)
      }
    }
  }, [labelMode])

  useEffect(() => {
    let cancelled = false
    loadAMap()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return
                
        // 图层切换重建时携带原视野, 避免把用户带回默认点
        let skipFit = false
        if (!mapRef.current) {
          const restored = viewRef.current
          viewRef.current = null
          if (restored) skipFit = true
          const center = restored
            ? restored.center
            : points.length > 0 ? [points[0].lng, points[0].lat] : DEFAULT_CENTER

          // 根据图层模式组装 layers: 卫星图不加 mapStyle (自定义样式会盖住卫星瓦片)
          const mapOpts = {
            zoom: restored ? restored.zoom : 13,
            center,
            maxZoom: 19,                // 实测卫星瓦片真实最高 z19 (z20 是 z19 原图直返)
            resizeEnable: true,
            scrollEnable: true,           // 启用滚轮缩放
            dragEnable: true,             // 启用拖拽
            moveAnim: false,              // 地图平移动画关闭（提升滑动响应速度）
            zoomAnim: true,               // 缩放开启动画（双击时平滑过渡）
          }
          if (satelliteRef.current) {
            // 卫星图: 初始化时直接携带 Satellite 图层 (v1.4 动态 addLayer 有兼容坑)
            mapOpts.layers = [new AMap.TileLayer.Satellite()]
            // 未隐藏标注时叠加 RoadNet 官方图层 (地名/路名, 会连同路线一起显示)
            if (!hiddenPOIRef.current) {
              mapOpts.layers.push(new AMap.TileLayer.RoadNet())
            }
          } else {
            // 普通图用标准底图: 自定义 mapStyle (grey) 在销毁重建后样式资源加载失败会黑屏
            mapOpts.layers = [new AMap.TileLayer()]
          }
          mapRef.current = new AMap.Map(containerRef.current, mapOpts)

          // 记录标注图层引用 (供后续显隐切换)
          if (satelliteRef.current && !hiddenPOIRef.current) {
            roadNetRef.current = mapOpts.layers[1]
          }
              
          // 初始设置 features (仅对普通底图生效; 卫星图由 RoadNet 图层控制标注)
          if (hiddenPOIRef.current) {
            mapRef.current.setFeatures(FEATURES_HIDDEN)
          } else {
            mapRef.current.setFeatures(FEATURES_SHOWN)
          }
              
          // 注册比例尺插件
          mapRef.current.plugin(['AMap.Scale', 'AMap.Geocoder'], () => {
            // 插件就绪即可, 无需额外监听 (zoomend 里不要动 setMapLevel, 会打断用户缩放)
          })
        }
        
        
        // 增量同步标记：每个 imei 只保留最新位置
        const markers = markersRef.current
        const seen = new Set()
        let hasNewMarker = false // 本次是否有新标记诞生 (决定视野调整方式)
        // console.log('[FleetMap] showLabels:', showLabels, 'points count:', points.length)
        points.forEach((p) => {
          if (!validCoord(p.lat, p.lng)) {
            console.warn('[FleetMap] 跳过无效坐标:', p.imei, p.lat, p.lng)
            return
          }
          seen.add(p.imei)
          const pos = [p.lng, p.lat]
          const marker = markers[p.imei]
          if (marker) {
            // 位置更新：setPosition 即时跳转 (moveTo 动画在 v1.4 下会产生 NaN 错误)
            marker.setPosition(pos)
            updateMarkerLabel(marker, p, labelModeRef.current)
          } else {
            // 新定位点：直接创建在正确位置
            hasNewMarker = true
            const labelModeValue = labelModeRef.current
            // 注意：title 只用于鼠标悬停显示，与 label 无关
            const title = `${p.name || p.imei} ${formatFixTime(p.lastFix) ? ' • ' + formatFixTime(p.lastFix) : ''}`
            const m = new AMap.Marker({
              map: mapRef.current,
              position: pos,
              title: title
            })
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
        // 视野策略 (定位数据变化时, 对比坐标快照判定, 无关渲染不触发):
        // - 新标记诞生 → 无条件框选全部 (定位是低频珍贵事件; z3/z4 下标点虽在视野内
        //   但动画不可感知, 必须拉到合适层级)
        // - 已有设备位置更新且全部在视野内 → 不动 (不打扰用户当前观察)
        // - 已有设备移动出界 → 平移到点集几何中心, 保持缩放级别 (视角平稳不伸缩)
        // - 图层切换重建 → 跳过 (保持切换前视角)
        const snapshot = {}
        let changed = Object.keys(positionsRef.current).length !== points.length
        points.forEach((p) => {
          const key = `${p.lat},${p.lng}`
          snapshot[p.imei] = key
          if (positionsRef.current[p.imei] !== key) changed = true
        })
        positionsRef.current = snapshot
        if (changed && !skipFit && points.length > 0) {
          const ms = Object.values(markers)
          if (hasNewMarker) {
            // 统一留白 80: 单点/多点一致, 避免切换时留白忽大忽小
            mapRef.current.setFitView(ms, false, [80, 80, 80, 80])
          } else {
            const bounds = mapRef.current.getBounds()
            const allVisible = bounds && ms.every((m) => bounds.contains(m.getPosition()))
            if (!allVisible) {
              // 点集几何中心: 只平移不缩放, 避免频繁定位时视角反复伸缩
              const clng = points.reduce((s, p) => s + p.lng, 0) / points.length
              const clat = points.reduce((s, p) => s + p.lat, 0) / points.length
              mapRef.current.panTo([clng, clat])
            }
          }
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [points, layerEpoch]) // 移除 showLabels 依赖

  // 卫星图/普通图切换: 销毁重建地图实例, 用初始化 layers 参数选择图层组合
  // (AMap v1.4 的 addLayer 动态叠加存在兼容坑, 重建最稳; 标记会随 points effect 自动重建)
  useEffect(() => {
    satelliteRef.current = satellite
    if (mapRef.current) {
      // 销毁前记住当前视野 (中心点+缩放级别), 重建后原样恢复
      viewRef.current = {
        center: mapRef.current.getCenter(),
        zoom: mapRef.current.getZoom(),
      }
      mapRef.current.destroy()
      mapRef.current = null
      markersRef.current = {}
      roadNetRef.current = null
      setLayerEpoch((e) => e + 1)
    }
  }, [satellite])

  // POI 显隐切换: 普通图用 setFeatures 即时生效; 卫星图动态增删 RoadNet 官方图层
  // (官方图层 add/remove 实测可用, 无需重建地图, 切换无闪烁)
  useEffect(() => {
    hiddenPOIRef.current = hiddenPOI
    if (!mapRef.current) return
    if (satelliteRef.current) {
      if (hiddenPOI) {
        if (roadNetRef.current) {
          mapRef.current.remove(roadNetRef.current)
          roadNetRef.current = null
        }
      } else if (!roadNetRef.current && window.AMap) {
        roadNetRef.current = new window.AMap.TileLayer.RoadNet()
        mapRef.current.add(roadNetRef.current)
      }
    } else {
      mapRef.current.setFeatures(hiddenPOI ? FEATURES_HIDDEN : FEATURES_SHOWN)
    }
  }, [hiddenPOI])

  // 组件卸载时销毁地图实例和清除定时器
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
        markersRef.current = {}
        roadNetRef.current = null
      }
      // 清除定时器
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current)
        timeUpdateIntervalRef.current = null
      }
    }
  }, [])

  // 每秒更新时间显示（每 1000ms）
  useEffect(() => {
    if (!mapRef.current || points.length === 0) return
    
    // 清除旧的定时器（如果存在）
    if (timeUpdateIntervalRef.current) {
      clearInterval(timeUpdateIntervalRef.current)
    }
    
    // 立即执行一次
    const markers = markersRef.current
    for (const imei in markers) {
      const p = points.find(point => point.imei === imei)
      if (p) {
        updateMarkerLabel(markers[imei], p, labelModeRef.current)
      }
    }
    
    // 设置定时器每秒刷新
    timeUpdateIntervalRef.current = setInterval(() => {
      const currentMarkers = markersRef.current
      for (const imei in currentMarkers) {
        const p = points.find(point => point.imei === imei)
        if (p) {
          updateMarkerLabel(currentMarkers[imei], p, labelModeRef.current)
        }
      }
    }, 1000)
    
    return () => {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current)
        timeUpdateIntervalRef.current = null
      }
    }
  }, [points])

  if (loadError) {
    return <div className="map-error">地图加载失败，请检查网络或 key 配置</div>
  }
  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-view" />
    </div>
  )
}
