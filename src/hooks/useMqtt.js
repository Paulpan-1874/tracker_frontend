import { useEffect, useRef, useState, useCallback } from 'react'
import mqtt from 'mqtt'
import { MQTT_URL, DATA_TOPIC, STATUS_TOPIC, LOCATION_TOPIC, cmdTopic, locationTopic, broadcastTopic } from '../config'

// 连接状态: connecting | connected | error
// userId: 登录用户 id, 传入后自动订阅其广播主题并同步 retained 广播实况
export function useMqtt(userId) {
  const clientRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const [devices, setDevices] = useState({})
  // 当前生效的广播指令 (来自 Broker retained, 非本地记忆, 不会假广播)
  const [broadcast, setBroadcast] = useState(null)

  // 建立 MQTT 连接并订阅上报主题
  useEffect(() => {
    const client = mqtt.connect(MQTT_URL, {
      clientId: 'web_console_' + Math.random().toString(16).slice(2, 10),
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 8000
    })
    clientRef.current = client

    client.on('connect', () => {
      setStatus('connected')
      const topics = [DATA_TOPIC, STATUS_TOPIC, LOCATION_TOPIC]
      if (userId) topics.push(broadcastTopic(userId))
      client.subscribe(topics, { qos: 0 })
    })
    client.on('reconnect', () => setStatus('connecting'))
    client.on('error', () => setStatus('error'))
    client.on('close', () => {
      setStatus((s) => (s === 'connected' ? 'connecting' : s))
    })

    client.on('message', (topic, payload) => {
      // 广播主题: retained 消息订阅后立即送达, 以此同步按钮真实状态
      if (userId && topic === broadcastTopic(userId)) {
        const text = payload.toString()
        if (!text) {
          setBroadcast(null)   // 空 retained = 广播已撤回
          return
        }
        try {
          setBroadcast(JSON.parse(text))
        } catch (e) {
          setBroadcast(null)
        }
        return
      }

      // 收到设备消息: device/{imei}/data 或 device/{imei}/status
      const parts = topic.split('/')
      if (parts.length !== 3 || parts[0] !== 'device') return
      const imei = parts[1]
      const kind = parts[2]
      if (kind !== 'data' && kind !== 'status' && kind !== 'location') return
      let data = {}
      try {
        data = JSON.parse(payload.toString())
      } catch (e) {
        data = { raw: payload.toString() }
      }
      // 时间全部用本地到达时间 (lastMsgAt / receivedAt): 两端时钟可能不同步, 不解析设备时间戳;
      // data.time 仅用于离线时展示"最后上报于"。消息解析失败才回退本地时间
      const parsedTime = data.time ? Date.parse(data.time) : NaN
      const now = isNaN(parsedTime) ? Date.now() : parsedTime
      const arrivedAt = Date.now()

      setDevices((prev) => {
        const old = prev[imei] || { imei, events: [] }

        // 在线状态 (retained): 权威判定 online/offline
        // 单一数据源: 最后在线时间只在"确认离线"时写入 (取离线消息自带的 time);
        // 上线及后续上报都不覆盖, 避免 retained 重发把时间重置成"刚刚"
        if (kind === 'status') {
          const offline = data.event === 'offline'
          return {
            ...prev,
            [imei]: {
              ...old,
              imei,
              status: data,
              hasStatus: true,
              online: !offline,
              lastSeen: offline ? now : old.lastSeen,
              lastMsgAt: arrivedAt
            }
          }
        }

        // 最后位置 (retained): 地图与定位状态的唯一数据源, 直接覆盖 location 字段, 不进 events
        // status: locating(过程态) → ok/failed(结果态); 空 retained = 已清除 (撤回广播时前端批量清空)
        // receivedAt = 本地到达时间: 仅供"定位中"计时展示, 不参与状态判定
        if (kind === 'location') {
          if (!payload.length) {
            return { ...prev, [imei]: { ...old, imei, location: null, locating: false, lastMsgAt: arrivedAt } }
          }
          return {
            ...prev,
            [imei]: {
              ...old,
              imei,
              location: { ...data, receivedAt: arrivedAt },
              locating: data.status === 'locating',
              lastMsgAt: arrivedAt
            }
          }
        }

        // 数据上报: 只更新遥测; 定位状态不从 data 取 (唯一来源是 retained location)
        // lastMsgAt 同步刷新: 搜星心跳 (gps_searching) 也走这里, 供"定位中"计时展示
        return {
          ...prev,
          [imei]: {
            ...old,
            imei,
            telemetry: data,
            events: [...(old.events || []), data].slice(-30),
            lastMsgAt: arrivedAt
          }
        }
      })
    })

    return () => {
      client.end(true)
      clientRef.current = null
    }
  }, [userId])

  // 下发指令到 device/{imei}/cmd
  const sendCommand = useCallback((imei, action) => {
    const client = clientRef.current
    if (!client || !client.connected) return false
    let payload
    if (typeof action === 'string') {
      const trimmed = action.trim()
      // 若用户粘贴的是完整 JSON, 直接解析使用, 避免双重编码
      if (trimmed.startsWith('{')) {
        try {
          payload = JSON.parse(trimmed)
        } catch (e) {
          payload = { action: trimmed }
        }
      } else {
        payload = { action: trimmed }
      }
    } else {
      payload = action
    }
    client.publish(cmdTopic(imei), JSON.stringify(payload), { qos: 1 })
    return true
  }, [])

  // 广播指令到 user/{userId}/cmd_broadcast (retained):
  // 常驻 Broker, 名下所有设备每次上线都会收到, 实现"一键指挥所有设备"
  // cmd_id 唯一标识本次广播, 固件按其去重, 避免设备重复执行
  const sendBroadcast = useCallback((userId, action) => {
    const client = clientRef.current
    if (!client || !client.connected || !userId) return false
    const payload = {
      action,
      broadcast: true,
      cmd_id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      time: new Date().toISOString()
    }
    client.publish(broadcastTopic(userId), JSON.stringify(payload), { qos: 1, retain: true })
    return true
  }, [])

  // 撤回广播: 发空 retained 消息清除 Broker 上的常驻指令,
  // 同时批量清空名下所有设备的 retained 位置 (定位会话收尾, 地图归零)
  const clearBroadcast = useCallback((userId, imeis = []) => {
    const client = clientRef.current
    if (!client || !client.connected || !userId) return false
    client.publish(broadcastTopic(userId), '', { qos: 1, retain: true })
    imeis.forEach((imei) => {
      client.publish(locationTopic(imei), '', { qos: 1, retain: true })
    })
    return true
  }, [])

  return { status, devices, sendCommand, sendBroadcast, clearBroadcast, broadcast }
}
