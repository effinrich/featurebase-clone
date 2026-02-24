import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const changelog = new Hono<{ Bindings: Bindings }>()

// Get all changelog entries (public gets only published)
changelog.get('/', async (c) => {
  const all = c.req.query('all') === 'true'
  let query = `SELECT * FROM changelog`
  if (!all) query += ` WHERE published = 1`
  query += ` ORDER BY published_at DESC, created_at DESC`

  const result = await c.env.DB.prepare(query).all()
  return c.json({ entries: result.results })
})

// Get single entry
changelog.get('/:id', async (c) => {
  const id = c.req.param('id')
  const entry = await c.env.DB.prepare(`SELECT * FROM changelog WHERE id = ?`).bind(id).first()
  if (!entry) return c.json({ error: 'Entry not found' }, 404)
  return c.json({ entry })
})

// Create entry (admin)
changelog.post('/', async (c) => {
  const body = await c.req.json()
  const { title, content, tags, published } = body

  if (!title || !content) return c.json({ error: 'Missing required fields' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO changelog (title, content, tags, published, published_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    title, content, tags || null, published ? 1 : 0,
    published ? new Date().toISOString() : null
  ).run()

  const entry = await c.env.DB.prepare(`SELECT * FROM changelog WHERE id = ?`).bind(result.meta.last_row_id).first()
  return c.json({ entry }, 201)
})

// Update entry (admin)
changelog.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { title, content, tags, published } = body

  const existing = await c.env.DB.prepare(`SELECT * FROM changelog WHERE id = ?`).bind(id).first() as any
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const publishedAt = published && !existing.published ? new Date().toISOString() : existing.published_at

  await c.env.DB.prepare(`
    UPDATE changelog SET title = ?, content = ?, tags = ?, published = ?, published_at = ? WHERE id = ?
  `).bind(title, content, tags || null, published ? 1 : 0, publishedAt, id).run()

  const entry = await c.env.DB.prepare(`SELECT * FROM changelog WHERE id = ?`).bind(id).first()
  return c.json({ entry })
})

// Delete entry (admin)
changelog.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM changelog WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

export default changelog
