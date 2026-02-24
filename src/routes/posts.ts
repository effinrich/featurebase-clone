import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const posts = new Hono<{ Bindings: Bindings }>()

// Get all posts for a board
posts.get('/', async (c) => {
  const boardSlug = c.req.query('board') || 'product-feedback'
  const status = c.req.query('status')
  const sort = c.req.query('sort') || 'votes'
  const search = c.req.query('search')
  const tag = c.req.query('tag')

  let query = `
    SELECT p.*, s.name as status_name, s.color as status_color,
           GROUP_CONCAT(t.name) as tag_names,
           GROUP_CONCAT(t.color) as tag_colors,
           GROUP_CONCAT(t.id) as tag_ids
    FROM posts p
    LEFT JOIN statuses s ON p.status_id = s.id
    LEFT JOIN boards b ON p.board_id = b.id
    LEFT JOIN post_tags pt ON p.id = pt.post_id
    LEFT JOIN tags t ON pt.tag_id = t.id
    WHERE b.slug = ?
  `
  const params: any[] = [boardSlug]

  if (status && status !== 'all') {
    query += ` AND s.name = ?`
    params.push(status)
  }
  if (search) {
    query += ` AND (p.title LIKE ? OR p.content LIKE ?)`
    params.push(`%${search}%`, `%${search}%`)
  }
  if (tag) {
    query += ` AND p.id IN (SELECT post_id FROM post_tags pt2 JOIN tags t2 ON pt2.tag_id = t2.id WHERE t2.name = ?)`
    params.push(tag)
  }

  query += ` GROUP BY p.id`

  if (sort === 'votes') query += ` ORDER BY p.is_pinned DESC, p.vote_count DESC, p.created_at DESC`
  else if (sort === 'newest') query += ` ORDER BY p.is_pinned DESC, p.created_at DESC`
  else if (sort === 'oldest') query += ` ORDER BY p.is_pinned DESC, p.created_at ASC`

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ posts: result.results })
})

// Get single post
posts.get('/:id', async (c) => {
  const id = c.req.param('id')
  const post = await c.env.DB.prepare(`
    SELECT p.*, s.name as status_name, s.color as status_color,
           GROUP_CONCAT(t.name) as tag_names,
           GROUP_CONCAT(t.color) as tag_colors,
           GROUP_CONCAT(t.id) as tag_ids
    FROM posts p
    LEFT JOIN statuses s ON p.status_id = s.id
    LEFT JOIN post_tags pt ON p.id = pt.post_id
    LEFT JOIN tags t ON pt.tag_id = t.id
    WHERE p.id = ?
    GROUP BY p.id
  `).bind(id).first()

  if (!post) return c.json({ error: 'Post not found' }, 404)

  const comments = await c.env.DB.prepare(`
    SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC
  `).bind(id).all()

  return c.json({ post, comments: comments.results })
})

// Create post
posts.post('/', async (c) => {
  const body = await c.req.json()
  const { board_id, title, content, author_name, author_email, tags } = body

  if (!title || !author_name || !board_id) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  // Get default status
  const defaultStatus = await c.env.DB.prepare(
    `SELECT id FROM statuses WHERE board_id = ? AND is_default = 1 LIMIT 1`
  ).bind(board_id).first() as any

  const result = await c.env.DB.prepare(`
    INSERT INTO posts (board_id, status_id, title, content, author_name, author_email)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(board_id, defaultStatus?.id || null, title, content || '', author_name, author_email || null).run()

  const postId = result.meta.last_row_id

  // Add tags
  if (tags && Array.isArray(tags)) {
    for (const tagId of tags) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)`).bind(postId, tagId).run()
    }
  }

  const newPost = await c.env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(postId).first()
  return c.json({ post: newPost }, 201)
})

// Update post (admin)
posts.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { title, content, status_id, is_pinned, eta, changelog_url, tags } = body

  await c.env.DB.prepare(`
    UPDATE posts SET title = ?, content = ?, status_id = ?, is_pinned = ?, eta = ?, changelog_url = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(title, content, status_id, is_pinned ? 1 : 0, eta || null, changelog_url || null, id).run()

  // Update tags
  if (tags !== undefined) {
    await c.env.DB.prepare(`DELETE FROM post_tags WHERE post_id = ?`).bind(id).run()
    for (const tagId of tags) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)`).bind(id, tagId).run()
    }
  }

  const updated = await c.env.DB.prepare(`
    SELECT p.*, s.name as status_name, s.color as status_color
    FROM posts p LEFT JOIN statuses s ON p.status_id = s.id WHERE p.id = ?
  `).bind(id).first()

  return c.json({ post: updated })
})

// Delete post (admin)
posts.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// Vote on post
posts.post('/:id/vote', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { voter_name, voter_email } = body
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

  // Check if already voted (by email or IP)
  let existingVote: any = null
  if (voter_email) {
    existingVote = await c.env.DB.prepare(
      `SELECT id FROM votes WHERE post_id = ? AND voter_email = ?`
    ).bind(id, voter_email).first()
  }
  if (!existingVote) {
    existingVote = await c.env.DB.prepare(
      `SELECT id FROM votes WHERE post_id = ? AND voter_ip = ?`
    ).bind(id, ip).first()
  }

  if (existingVote) {
    // Unvote
    await c.env.DB.prepare(`DELETE FROM votes WHERE id = ?`).bind((existingVote as any).id).run()
    await c.env.DB.prepare(`UPDATE posts SET vote_count = vote_count - 1 WHERE id = ?`).bind(id).run()
    return c.json({ voted: false, message: 'Vote removed' })
  }

  // Add vote
  await c.env.DB.prepare(
    `INSERT INTO votes (post_id, voter_name, voter_email, voter_ip) VALUES (?, ?, ?, ?)`
  ).bind(id, voter_name || 'Anonymous', voter_email || null, ip).run()

  await c.env.DB.prepare(`UPDATE posts SET vote_count = vote_count + 1 WHERE id = ?`).bind(id).run()
  return c.json({ voted: true, message: 'Vote added' })
})

// Check vote status
posts.get('/:id/vote', async (c) => {
  const id = c.req.param('id')
  const email = c.req.query('email')
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

  let voted = false
  if (email) {
    const v = await c.env.DB.prepare(`SELECT id FROM votes WHERE post_id = ? AND voter_email = ?`).bind(id, email).first()
    if (v) voted = true
  }
  if (!voted) {
    const v = await c.env.DB.prepare(`SELECT id FROM votes WHERE post_id = ? AND voter_ip = ?`).bind(id, ip).first()
    if (v) voted = true
  }

  return c.json({ voted })
})

// Add comment
posts.post('/:id/comments', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { author_name, author_email, content, parent_id, is_admin } = body

  if (!content || !author_name) return c.json({ error: 'Missing required fields' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO comments (post_id, parent_id, author_name, author_email, content, is_admin)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, parent_id || null, author_name, author_email || null, content, is_admin ? 1 : 0).run()

  await c.env.DB.prepare(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?`).bind(id).run()

  const comment = await c.env.DB.prepare(`SELECT * FROM comments WHERE id = ?`).bind(result.meta.last_row_id).first()
  return c.json({ comment }, 201)
})

// Delete comment (admin)
posts.delete('/:id/comments/:commentId', async (c) => {
  const { id, commentId } = c.req.param()
  await c.env.DB.prepare(`DELETE FROM comments WHERE id = ? AND post_id = ?`).bind(commentId, id).run()
  await c.env.DB.prepare(`UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

export default posts
