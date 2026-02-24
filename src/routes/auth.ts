import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Bindings = { DB: D1Database }
const auth = new Hono<{ Bindings: Bindings }>()

function generateSessionId(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Login
auth.post('/login', async (c) => {
  const body = await c.req.json()
  const { username, password } = body

  const admin = await c.env.DB.prepare(
    `SELECT * FROM admins WHERE username = ?`
  ).bind(username).first() as any

  if (!admin) return c.json({ error: 'Invalid credentials' }, 401)

  // Simple password check (in production use bcrypt)
  if (admin.password_hash !== password) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const sessionId = generateSessionId()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, admin_id, expires_at) VALUES (?, ?, ?)`
  ).bind(sessionId, admin.id, expiresAt).run()

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60,
    path: '/'
  })

  return c.json({ 
    success: true, 
    admin: { id: admin.id, username: admin.username, email: admin.email }
  })
})

// Logout
auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session')
  if (sessionId) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run()
    deleteCookie(c, 'session', { path: '/' })
  }
  return c.json({ success: true })
})

// Check session
auth.get('/me', async (c) => {
  const sessionId = getCookie(c, 'session')
  if (!sessionId) return c.json({ admin: null })

  const session = await c.env.DB.prepare(
    `SELECT s.*, a.username, a.email FROM sessions s 
     JOIN admins a ON s.admin_id = a.id 
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(sessionId).first() as any

  if (!session) {
    deleteCookie(c, 'session', { path: '/' })
    return c.json({ admin: null })
  }

  return c.json({ 
    admin: { id: session.admin_id, username: session.username, email: session.email }
  })
})

// Change password
auth.post('/change-password', async (c) => {
  const sessionId = getCookie(c, 'session')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)

  const session = await c.env.DB.prepare(
    `SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')`
  ).bind(sessionId).first() as any

  if (!session) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json()
  const { current_password, new_password } = body

  const admin = await c.env.DB.prepare(`SELECT * FROM admins WHERE id = ?`).bind(session.admin_id).first() as any
  if (admin.password_hash !== current_password) {
    return c.json({ error: 'Current password is incorrect' }, 400)
  }

  await c.env.DB.prepare(`UPDATE admins SET password_hash = ? WHERE id = ?`).bind(new_password, session.admin_id).run()
  return c.json({ success: true })
})

export default auth
