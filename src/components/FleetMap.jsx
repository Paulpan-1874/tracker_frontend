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

// 多设备总览地图：points = [{ imei, lat, lng }] (经纬度须已纠偏为 GCJ-02)
// 空数组时展示默认地图; 新定位到达时增量点亮对应标记并自动框选视野
// satellite 由外部 (App) 控制，切换按钮已移到顶部面板内
export default function FleetMap({ points, satellite, hiddenPOI = true }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({}) // imei -> AMap.Marker
  const satelliteRef = useRef(satellite) // 图层模式 (ref 供地图初始化读取)
  const hiddenPOIRef = useRef(hiddenPOI) // POI 显隐 (ref 供地图初始化读取)
  const roadNetRef = useRef(null) // 卫星模式下的路网标注图层 (RoadNet: 地名+路线合层)
  const [loadError, setLoadError] = useState(false)
  const [layerEpoch, setLayerEpoch] = useState(0) // 图层切换时递增, 触发地图重建

  useEffect(() => {
    let cancelled = false
    loadAMap()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return
                
        if (!mapRef.current) {
          const center = points.length > 0 ? [points[0].lng, points[0].lat] : DEFAULT_CENTER

          // 根据图层模式组装 layers: 卫星图不加 mapStyle (自定义样式会盖住卫星瓦片)
          const mapOpts = {
            zoom: 13,
            center,
            resizeEnable: true,
            scrollEnable: true,           // 启用滚轮缩放
            dragEnable: true,             // 启用拖拽
            moveAnim: false,              // 地图平移动画关闭（提升滑动响应速度）
            zoomAnim: false,              // 缩放动画关闭（提升缩放响应速度）
          }
          if (satelliteRef.current) {
            // 卫星图: 初始化时直接携带 Satellite 图层 (v1.4 动态 addLayer 有兼容坑)
            mapOpts.layers = [new AMap.TileLayer.Satellite()]
            // 未隐藏标注时叠加 RoadNet 官方图层 (地名/路名, 会连同路线一起显示)
            if (!hiddenPOIRef.current) {
              mapOpts.layers.push(new AMap.TileLayer.RoadNet())
            }
          } else {
            mapOpts.mapStyle = 'amap://styles/grey'  // 灰色风格减少干扰
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

  // 组件卸载时销毁地图实例
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
        markersRef.current = {}
        roadNetRef.current = null
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
