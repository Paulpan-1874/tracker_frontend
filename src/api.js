// PocketBase API 客户端: 登录态管理 + 按用户拉取设备列表
import { PB_URL } from './config'

const TOKEN_KEY = 'pb_token'
const USER_KEY = 'pb_user'

// 读取本地保存的登录态 (无则 null)
export function getAuth() {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return null
  let user = {}
  try {
    user = JSON.parse(localStorage.getItem(USER_KEY) || '{}')
  } catch (e) {
    // 忽略损坏的用户数据
  }
  return { token, user }
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// 登录 (identity 支持邮箱或用户名), 成功返回 { token, user }
export async function login(identity, password) {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password })
  })
  if (!res.ok) throw new Error('账号或密码错误')
  const data = await res.json()
  const user = {
    id: data.record.id,
    name: data.record.name || data.record.email || identity
  }
  localStorage.setItem(TOKEN_KEY, data.token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return { token: data.token, user }
}

// 拉取当前用户名下的设备 (devices 集合，按 owner 过滤), 返回 [{ device_id, name }]
export async function fetchMyDevices(token, userId) {
  const filter = encodeURIComponent(`owner="${userId}"`)
  const res = await fetch(
    `${PB_URL}/api/collections/devices/records?perPage=200&filter=${filter}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (res.status === 401 || res.status === 403) throw new Error('unauthorized')
  if (!res.ok) throw new Error('fetch devices failed')
  const data = await res.json()
  return (data.items || []).map((i) => ({
    device_id: i.device_id,
    name: i.name || null
  })).filter((d) => d.device_id)
}
