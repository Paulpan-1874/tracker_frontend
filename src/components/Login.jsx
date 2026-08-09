import { useState } from 'react'
import { login } from '../api'

// 登录页: 账号(邮箱/用户名) + 密码
export default function Login({ onLogin }) {
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!identity.trim() || !password) {
      setError('请输入账号和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      const auth = await login(identity.trim(), password)
      onLogin(auth)
    } catch (err) {
      setError(err.message || '登录失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>设备控制台</h1>
        <p className="login-sub">登录后管理你的设备</p>
        <form onSubmit={submit}>
          <input
            className="login-input"
            placeholder="邮箱或用户名"
            value={identity}
            autoComplete="username"
            onChange={(e) => setIdentity(e.target.value)}
          />
          <input
            className="login-input"
            type="password"
            placeholder="密码"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? '登录中…' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  )
}
