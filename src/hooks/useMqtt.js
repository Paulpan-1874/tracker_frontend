import { useEffect, useRef, useState, useCallback } from 'react'
import mqtt from 'mqtt'
import { MQTT_URL, DATA_TOPIC, STATUS_TOPIC, LOCATION_TOPIC, cmdTopic, broadcastTopic, ONLINE_TIMEOUT_MS } from '../config'

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
      const now = Date.now()

      setDevices((prev) => {
        const old = prev[imei] || { imei, events: [] }

        // 在线状态 (retained): 权威判定 online/offline
        if (kind === 'status') {
          return {
            ...prev,
            [imei]: {
              ...old,
              imei,
              status: data,
              hasStatus: true,
              online: data.event !== 'offline',
              lastSeen: now
            }
          }
        }

        // 最后位置 (retained): 只进 events 供地图展示, 不覆盖 telemetry 遥测
        if (kind === 'location') {
          return {
            ...prev,
            [imei]: {
              ...old,
              imei,
              lastSeen: now,
              online: old.hasStatus ? old.online : true,
              events: [...(old.events || []), data].slice(-30)
            }
          }
        }

        // 数据上报: 更新遥测; 不覆盖 retained 状态判定的在线性
        return {
          ...prev,
          [imei]: {
            ...old,
            imei,
            telemetry: data,
            lastSeen: now,
            online: old.hasStatus ? old.online : true,
            events: [...(old.events || []), data].slice(-30)
          }
        }
      })
    })

    return () => {
      client.end(true)
      clientRef.current = null
    }
  }, [userId])

  // 兜底: 对没有 retained status 的设备, 用上报超时判定离线
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setDevices((prev) => {
        let changed = false
        const next = {}
        for (const key of Object.keys(prev)) {
          const d = prev[key]
          // 有 retained status 的设备信任 status (LWT 会翻转), 不用超时覆盖
          if (d.hasStatus) {
            next[key] = d
            continue
          }
          const online = now - d.lastSeen < ONLINE_TIMEOUT_MS
          if (online !== d.online) changed = true
          next[key] = { ...d, online }
        }
        return changed ? next : prev
      })
    }, 5000)
    return () => clearInterval(timer)
  }, [])

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

  // 撤回广播: 发空 retained 消息清除 Broker 上的常驻指令
  const clearBroadcast = useCallback((userId) => {
    const client = clientRef.current
    if (!client || !client.connected || !userId) return false
    client.publish(broadcastTopic(userId), '', { qos: 1, retain: true })
    return true
  }, [])

  return { status, devices, sendCommand, sendBroadcast, clearBroadcast, broadcast }
}
