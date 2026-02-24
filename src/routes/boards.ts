import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const boards = new Hono<{ Bindings: Bindings }>()

// Get all boards
boards.get('/', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT b.*, 
           COUNT(p.id) as post_count
    FROM boards b
    LEFT JOIN posts p ON b.id = p.board_id
    GROUP BY b.id
    ORDER BY b.id ASC
  `).all()
  return c.json({ boards: result.results })
})

// Get board by slug
boards.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const board = await c.env.DB.prepare(`SELECT * FROM boards WHERE slug = ?`).bind(slug).first()
  if (!board) return c.json({ error: 'Board not found' }, 404)

  const statuses = await c.env.DB.prepare(`
    SELECT * FROM statuses WHERE board_id = ? ORDER BY sort_order ASC
  `).bind((board as any).id).all()

  const tags = await c.env.DB.prepare(`
    SELECT * FROM tags WHERE board_id = ? OR board_id IS NULL ORDER BY name ASC
  `).bind((board as any).id).all()

  // Status counts
  const statusCounts = await c.env.DB.prepare(`
    SELECT s.name, COUNT(p.id) as count
    FROM statuses s
    LEFT JOIN posts p ON p.status_id = s.id AND p.board_id = ?
    WHERE s.board_id = ?
    GROUP BY s.id
  `).bind((board as any).id, (board as any).id).all()

  return c.json({ board, statuses: statuses.results, tags: tags.results, statusCounts: statusCounts.results })
})

// Create board (admin)
boards.post('/', async (c) => {
  const body = await c.req.json()
  const { name, slug, description, color } = body

  if (!name || !slug) return c.json({ error: 'Missing required fields' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO boards (name, slug, description, color) VALUES (?, ?, ?, ?)
  `).bind(name, slug, description || '', color || '#6366f1').run()

  const boardId = result.meta.last_row_id

  // Create default statuses
  const defaultStatuses = [
    { name: 'Under Review', color: '#f59e0b', order: 0, isDefault: 1 },
    { name: 'Planned', color: '#3b82f6', order: 1, isDefault: 0 },
    { name: 'In Progress', color: '#8b5cf6', order: 2, isDefault: 0 },
    { name: 'Complete', color: '#10b981', order: 3, isDefault: 0 },
    { name: 'Closed', color: '#6b7280', order: 4, isDefault: 0 },
  ]
  for (const s of defaultStatuses) {
    await c.env.DB.prepare(`
      INSERT INTO statuses (board_id, name, color, sort_order, is_default) VALUES (?, ?, ?, ?, ?)
    `).bind(boardId, s.name, s.color, s.order, s.isDefault).run()
  }

  const board = await c.env.DB.prepare(`SELECT * FROM boards WHERE id = ?`).bind(boardId).first()
  return c.json({ board }, 201)
})

// Update board (admin)
boards.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, description, color } = body

  await c.env.DB.prepare(`
    UPDATE boards SET name = ?, description = ?, color = ? WHERE id = ?
  `).bind(name, description, color, id).run()

  const board = await c.env.DB.prepare(`SELECT * FROM boards WHERE id = ?`).bind(id).first()
  return c.json({ board })
})

// Delete board (admin)
boards.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM boards WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// Get statuses for a board
boards.get('/:id/statuses', async (c) => {
  const id = c.req.param('id')
  const statuses = await c.env.DB.prepare(
    `SELECT * FROM statuses WHERE board_id = ? ORDER BY sort_order ASC`
  ).bind(id).all()
  return c.json({ statuses: statuses.results })
})

// Update status
boards.put('/:id/statuses/:statusId', async (c) => {
  const { id, statusId } = c.req.param()
  const body = await c.req.json()
  const { name, color, sort_order } = body

  await c.env.DB.prepare(`
    UPDATE statuses SET name = ?, color = ?, sort_order = ? WHERE id = ? AND board_id = ?
  `).bind(name, color, sort_order, statusId, id).run()

  const status = await c.env.DB.prepare(`SELECT * FROM statuses WHERE id = ?`).bind(statusId).first()
  return c.json({ status })
})

export default boards
