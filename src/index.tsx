import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie } from 'hono/cookie'
import { serveStatic } from 'hono/cloudflare-workers'
import postsRoute from './routes/posts'
import boardsRoute from './routes/boards'
import authRoute from './routes/auth'
import changelogRoute from './routes/changelog'

type Bindings = { DB: D1Database }

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

// Admin auth middleware
async function requireAdmin(c: any, next: any) {
  const sessionId = getCookie(c, 'session')
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)
  
  const session = await c.env.DB.prepare(
    `SELECT s.*, a.username FROM sessions s JOIN admins a ON s.admin_id = a.id WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(sessionId).first()
  
  if (!session) return c.json({ error: 'Unauthorized' }, 401)
  c.set('admin', session)
  await next()
}

// API Routes
app.route('/api/auth', authRoute)
app.route('/api/posts', postsRoute)
app.route('/api/boards', boardsRoute)
app.route('/api/changelog', changelogRoute)

// Admin-only post operations
app.put('/api/posts/:id', requireAdmin, async (c) => c.json({}))
app.delete('/api/posts/:id', requireAdmin, async (c) => c.json({}))
app.delete('/api/posts/:id/comments/:commentId', requireAdmin, async (c) => c.json({}))
app.post('/api/boards', requireAdmin, async (c) => c.json({}))
app.delete('/api/boards/:id', requireAdmin, async (c) => c.json({}))
app.post('/api/changelog', requireAdmin, async (c) => c.json({}))
app.put('/api/changelog/:id', requireAdmin, async (c) => c.json({}))
app.delete('/api/changelog/:id', requireAdmin, async (c) => c.json({}))

// Stats API
app.get('/api/stats', async (c) => {
  const totalPosts = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM posts`).first() as any
  const totalVotes = await c.env.DB.prepare(`SELECT COALESCE(SUM(vote_count), 0) as count FROM posts`).first() as any
  const totalComments = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM comments`).first() as any
  const totalBoards = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM boards`).first() as any
  const recentPosts = await c.env.DB.prepare(
    `SELECT p.*, s.name as status_name FROM posts p LEFT JOIN statuses s ON p.status_id = s.id ORDER BY p.created_at DESC LIMIT 5`
  ).all()

  return c.json({
    posts: totalPosts?.count || 0,
    votes: totalVotes?.count || 0,
    comments: totalComments?.count || 0,
    boards: totalBoards?.count || 0,
    recentPosts: recentPosts.results,
  })
})

// Tags API
app.get('/api/tags', async (c) => {
  const boardId = c.req.query('board_id')
  let query = `SELECT * FROM tags`
  const params: any[] = []
  if (boardId) {
    query += ` WHERE board_id = ? OR board_id IS NULL`
    params.push(boardId)
  }
  query += ` ORDER BY name ASC`
  const tags = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ tags: tags.results })
})

app.post('/api/tags', async (c) => {
  const { name, color, board_id } = await c.req.json()
  const result = await c.env.DB.prepare(
    `INSERT INTO tags (name, color, board_id) VALUES (?, ?, ?)`
  ).bind(name, color || '#6366f1', board_id || null).run()
  const tag = await c.env.DB.prepare(`SELECT * FROM tags WHERE id = ?`).bind(result.meta.last_row_id).first()
  return c.json({ tag }, 201)
})

app.delete('/api/tags/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM tags WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// Serve static files
app.use('/static/*', serveStatic({ root: './' }))

// Serve the SPA for all other routes
app.get('*', (c) => {
  return c.html(getHTML())
})

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FeatureHub - Feature Requests & Feedback</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .sidebar { width: 260px; min-height: 100vh; }
    .vote-btn.voted { background: #6366f1 !important; color: white !important; }
    .vote-btn.voted .vote-count { color: white !important; }
    .post-card:hover { border-color: #6366f1; transform: translateY(-1px); }
    .post-card { transition: all 0.15s ease; }
    .modal-overlay { backdrop-filter: blur(4px); }
    .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 500; }
    .admin-badge { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; }
    .tag-badge { font-size: 11px; padding: 1px 7px; border-radius: 9999px; font-weight: 500; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { font-family: 'Fira Code', monospace; font-size: 13px; }
    .toast { position: fixed; bottom: 24px; right: 24px; z-index: 9999; animation: slideUp 0.3s ease; }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .progress-bar { height: 3px; background: linear-gradient(90deg, #6366f1, #8b5cf6); animation: progress 0.4s ease; }
    @keyframes progress { from { width: 0% } to { width: 100% } }
    .sidebar-link.active { background: rgba(99,102,241,0.1); color: #6366f1; border-right: 3px solid #6366f1; }
    .skeleton { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 6px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .roadmap-column { min-width: 280px; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f1f1f1; }
    ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
  </style>
</head>
<body class="bg-gray-50">
  <div id="app">
    <div class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p class="text-gray-500">Loading FeatureHub...</p>
      </div>
    </div>
  </div>
  <div id="toast-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script>
  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  const state = {
    view: 'board', // board | post | admin | changelog | roadmap | admin-post | admin-changelog | admin-boards | admin-settings
    boards: [],
    currentBoard: null,
    posts: [],
    currentPost: null,
    comments: [],
    statuses: [],
    tags: [],
    statusCounts: [],
    admin: null,
    changelog: [],
    stats: {},
    filters: { status: 'all', sort: 'votes', search: '', tag: '' },
    loading: false,
    votedPosts: new Set(JSON.parse(localStorage.getItem('votedPosts') || '[]')),
    userEmail: localStorage.getItem('userEmail') || '',
    userName: localStorage.getItem('userName') || '',
  };

  // ============================================================
  // UTILITIES
  // ============================================================
  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-indigo-500', warning: 'bg-yellow-500' };
    el.className = \`toast \${colors[type] || colors.success} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2\`;
    el.innerHTML = \`<i class="fas fa-\${type === 'success' ? 'check' : type === 'error' ? 'times' : 'info'}-circle"></i> \${msg}\`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function parseTagNames(post) {
    if (!post.tag_names) return [];
    const names = post.tag_names.split(',');
    const colors = post.tag_colors ? post.tag_colors.split(',') : [];
    const ids = post.tag_ids ? post.tag_ids.split(',') : [];
    return names.map((n, i) => ({ name: n, color: colors[i] || '#6366f1', id: ids[i] }));
  }

  // ============================================================
  // API CALLS
  // ============================================================
  async function api(method, url, data) {
    try {
      const res = await axios({ method, url: '/api' + url, data, withCredentials: true });
      return res.data;
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Network error';
      toast(msg, 'error');
      throw e;
    }
  }

  async function loadBoard(slug) {
    const data = await api('get', \`/boards/\${slug}\`);
    state.currentBoard = data.board;
    state.statuses = data.statuses || [];
    state.tags = data.tags || [];
    state.statusCounts = data.statusCounts || [];
    return data;
  }

  async function loadPosts() {
    const slug = state.currentBoard?.slug || 'product-feedback';
    const { status, sort, search, tag } = state.filters;
    const params = new URLSearchParams({ board: slug, sort });
    if (status !== 'all') params.set('status', status);
    if (search) params.set('search', search);
    if (tag) params.set('tag', tag);
    const data = await api('get', \`/posts?\${params}\`);
    state.posts = data.posts || [];
  }

  async function loadPost(id) {
    const data = await api('get', \`/posts/\${id}\`);
    state.currentPost = data.post;
    state.comments = data.comments || [];
  }

  async function loadChangelog(all = false) {
    const data = await api('get', \`/changelog\${all ? '?all=true' : ''}\`);
    state.changelog = data.entries || [];
  }

  async function loadStats() {
    const data = await api('get', '/stats');
    state.stats = data;
  }

  async function checkAuth() {
    try {
      const data = await api('get', '/auth/me');
      state.admin = data.admin;
    } catch (e) {
      state.admin = null;
    }
  }

  async function loadBoards() {
    const data = await api('get', '/boards');
    state.boards = data.boards || [];
  }

  // ============================================================
  // VOTE SYSTEM
  // ============================================================
  async function vote(postId, authorName, authorEmail) {
    if (!authorName) {
      showVoteModal(postId);
      return;
    }
    try {
      const data = await api('post', \`/posts/\${postId}/vote\`, { voter_name: authorName, voter_email: authorEmail });
      const voted = data.voted;
      const post = state.posts.find(p => p.id == postId);
      if (post) {
        post.vote_count = post.vote_count + (voted ? 1 : -1);
      }
      if (state.currentPost?.id == postId) {
        state.currentPost.vote_count = state.currentPost.vote_count + (voted ? 1 : -1);
      }
      if (voted) {
        state.votedPosts.add(postId);
        toast('Vote added!', 'success');
      } else {
        state.votedPosts.delete(postId);
        toast('Vote removed', 'info');
      }
      localStorage.setItem('votedPosts', JSON.stringify([...state.votedPosts]));
      render();
    } catch(e) {}
  }

  function showVoteModal(postId) {
    const modal = document.getElementById('vote-modal');
    if (modal) {
      modal.dataset.postId = postId;
      modal.classList.remove('hidden');
    }
  }

  // ============================================================
  // RENDER ENGINE
  // ============================================================
  function render() {
    const app = document.getElementById('app');
    if (state.view === 'admin-login') {
      app.innerHTML = renderAdminLogin();
    } else if (state.view === 'post') {
      app.innerHTML = renderLayout(renderPostDetail());
    } else if (state.view === 'changelog') {
      app.innerHTML = renderLayout(renderChangelog());
    } else if (state.view === 'roadmap') {
      app.innerHTML = renderLayout(renderRoadmap());
    } else if (state.view.startsWith('admin')) {
      app.innerHTML = renderAdminLayout();
    } else {
      app.innerHTML = renderLayout(renderBoard());
    }
    bindEvents();
  }

  // ============================================================
  // PUBLIC LAYOUT
  // ============================================================
  function renderLayout(content) {
    const boardName = state.currentBoard?.name || 'FeatureHub';
    const boardColor = state.currentBoard?.color || '#6366f1';
    return \`
    <div class="min-h-screen flex flex-col">
      <!-- Header -->
      <header class="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div class="flex items-center gap-6">
            <a href="#" onclick="navigate('board')" class="flex items-center gap-2 font-bold text-lg text-gray-900">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style="background:\${boardColor}">
                \${boardName.charAt(0).toUpperCase()}
              </div>
              <span>\${escapeHtml(boardName)}</span>
            </a>
            <nav class="hidden md:flex items-center gap-1">
              <a href="#" onclick="navigate('board')" class="nav-link px-3 py-1.5 rounded-md text-sm font-medium \${state.view === 'board' || state.view === 'post' ? 'text-indigo-600 bg-indigo-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}">
                <i class="fas fa-lightbulb mr-1"></i> Features
              </a>
              <a href="#" onclick="navigate('roadmap')" class="nav-link px-3 py-1.5 rounded-md text-sm font-medium \${state.view === 'roadmap' ? 'text-indigo-600 bg-indigo-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}">
                <i class="fas fa-map mr-1"></i> Roadmap
              </a>
              <a href="#" onclick="navigate('changelog')" class="nav-link px-3 py-1.5 rounded-md text-sm font-medium \${state.view === 'changelog' ? 'text-indigo-600 bg-indigo-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}">
                <i class="fas fa-scroll mr-1"></i> Changelog
              </a>
            </nav>
          </div>
          <div class="flex items-center gap-2">
            \${state.admin ? \`
              <span class="text-sm text-gray-500 hidden sm:block">
                <i class="fas fa-shield-alt text-indigo-500 mr-1"></i>\${state.admin.username}
              </span>
              <a href="#" onclick="navigate('admin')" class="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                <i class="fas fa-cog mr-1"></i> Admin
              </a>
            \` : \`
              <a href="#" onclick="navigate('admin-login')" class="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:border-gray-400">
                Sign in
              </a>
            \`}
          </div>
        </div>
      </header>
      \${content}
    </div>
    \`;
  }

  // ============================================================
  // BOARD VIEW
  // ============================================================
  function renderBoard() {
    const allCount = state.posts.length;
    return \`
    <div class="max-w-6xl mx-auto px-4 py-6 flex gap-6">
      <!-- Sidebar -->
      <aside class="hidden lg:block w-60 flex-shrink-0">
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div class="p-4 border-b border-gray-100">
            <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</h3>
          </div>
          <div class="p-2">
            <button onclick="filterStatus('all')" class="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between \${state.filters.status === 'all' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}">
              <span><i class="fas fa-th-list mr-2 opacity-50"></i>All Posts</span>
              <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100">\${allCount}</span>
            </button>
            \${state.statuses.map(s => {
              const count = (state.statusCounts.find(sc => sc.name === s.name) || {}).count || 0;
              return \`<button onclick="filterStatus('\${escapeHtml(s.name)}')" class="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between \${state.filters.status === s.name ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}">
                <span class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full" style="background:\${s.color}"></span>
                  \${escapeHtml(s.name)}
                </span>
                <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100">\${count}</span>
              </button>\`;
            }).join('')}
          </div>
          \${state.tags.length > 0 ? \`
          <div class="p-4 border-t border-gray-100">
            <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tags</h3>
            <div class="flex flex-wrap gap-1.5">
              \${state.tags.map(t => \`
                <button onclick="filterTag('\${escapeHtml(t.name)}')" class="tag-badge \${state.filters.tag === t.name ? 'ring-2 ring-offset-1' : ''}" style="background:\${t.color}20; color:\${t.color}; \${state.filters.tag === t.name ? 'ring-color:' + t.color : ''}">
                  \${escapeHtml(t.name)}
                </button>
              \`).join('')}
            </div>
          </div>\` : ''}
        </div>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0">
        <!-- Board header -->
        <div class="mb-6">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 class="text-2xl font-bold text-gray-900">\${escapeHtml(state.currentBoard?.name || '')}</h1>
              <p class="text-gray-500 mt-1">\${escapeHtml(state.currentBoard?.description || '')}</p>
            </div>
            <button onclick="showNewPostModal()" class="flex-shrink-0 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
              <i class="fas fa-plus"></i>
              <span class="hidden sm:inline">Submit Idea</span>
            </button>
          </div>

          <!-- Search & Sort -->
          <div class="flex flex-col sm:flex-row gap-3">
            <div class="flex-1 relative">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
              <input type="text" id="search-input" placeholder="Search ideas..." value="\${escapeHtml(state.filters.search)}"
                class="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
            <div class="flex gap-2">
              <select id="sort-select" class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="votes" \${state.filters.sort === 'votes' ? 'selected' : ''}>Most Voted</option>
                <option value="newest" \${state.filters.sort === 'newest' ? 'selected' : ''}>Newest</option>
                <option value="oldest" \${state.filters.sort === 'oldest' ? 'selected' : ''}>Oldest</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Posts list -->
        \${state.loading ? renderPostsSkeleton() : renderPostsList()}
      </main>
    </div>

    <!-- New Post Modal -->
    \${renderNewPostModal()}
    <!-- Vote Modal -->
    \${renderVoteModal()}
    \`;
  }

  function renderPostsList() {
    if (state.posts.length === 0) {
      return \`
        <div class="text-center py-16 bg-white rounded-xl border border-gray-200">
          <i class="fas fa-inbox text-5xl text-gray-300 mb-4"></i>
          <h3 class="text-lg font-medium text-gray-900 mb-1">No posts yet</h3>
          <p class="text-gray-500">Be the first to submit an idea!</p>
          <button onclick="showNewPostModal()" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            Submit Idea
          </button>
        </div>
      \`;
    }

    return state.posts.map(post => {
      const tags = parseTagNames(post);
      const voted = state.votedPosts.has(post.id);
      return \`
      <div class="post-card bg-white rounded-xl border border-gray-200 p-4 mb-3 cursor-pointer flex gap-3" onclick="openPost(\${post.id})">
        <!-- Vote button -->
        <div class="flex-shrink-0" onclick="event.stopPropagation()">
          <button class="vote-btn \${voted ? 'voted' : ''} flex flex-col items-center justify-center w-14 h-16 rounded-lg border-2 \${voted ? 'border-indigo-500 bg-indigo-500' : 'border-gray-200 hover:border-indigo-400'} transition-all"
            onclick="vote(\${post.id}, state.userName, state.userEmail)">
            <i class="fas fa-chevron-up text-sm \${voted ? 'text-white' : 'text-gray-500'}"></i>
            <span class="vote-count text-sm font-bold mt-0.5 \${voted ? 'text-white' : 'text-gray-700'}">\${post.vote_count}</span>
          </button>
        </div>
        <!-- Content -->
        <div class="flex-1 min-w-0">
          <div class="flex items-start gap-2 flex-wrap">
            \${post.is_pinned ? '<span class="badge bg-yellow-100 text-yellow-700"><i class="fas fa-thumbtack text-xs"></i> Pinned</span>' : ''}
            <h3 class="text-gray-900 font-semibold text-base leading-snug">\${escapeHtml(post.title)}</h3>
          </div>
          \${post.content ? \`<p class="text-gray-500 text-sm mt-1 line-clamp-2">\${escapeHtml(post.content.slice(0, 150))}\${post.content.length > 150 ? '...' : ''}</p>\` : ''}
          <div class="flex items-center gap-3 mt-2 flex-wrap">
            \${post.status_name ? \`<span class="badge" style="background:\${post.status_color}20; color:\${post.status_color}"><span class="w-1.5 h-1.5 rounded-full" style="background:\${post.status_color}"></span>\${escapeHtml(post.status_name)}</span>\` : ''}
            \${tags.map(t => \`<span class="tag-badge" style="background:\${t.color}20; color:\${t.color}">\${escapeHtml(t.name)}</span>\`).join('')}
            <span class="text-gray-400 text-xs ml-auto flex items-center gap-3">
              <span><i class="far fa-comment mr-1"></i>\${post.comment_count}</span>
              <span><i class="far fa-clock mr-1"></i>\${formatDate(post.created_at)}</span>
              <span class="font-medium text-gray-500">\${escapeHtml(post.author_name)}</span>
            </span>
          </div>
        </div>
      </div>
      \`;
    }).join('');
  }

  function renderPostsSkeleton() {
    return Array(4).fill('').map(() => \`
      <div class="bg-white rounded-xl border border-gray-200 p-4 mb-3 flex gap-3">
        <div class="skeleton w-14 h-16 rounded-lg"></div>
        <div class="flex-1">
          <div class="skeleton h-5 w-3/4 mb-2"></div>
          <div class="skeleton h-4 w-full mb-1"></div>
          <div class="skeleton h-4 w-2/3"></div>
        </div>
      </div>
    \`).join('');
  }

  // ============================================================
  // POST DETAIL VIEW
  // ============================================================
  function renderPostDetail() {
    if (!state.currentPost) return '<div class="p-8 text-center text-gray-500">Post not found</div>';
    const post = state.currentPost;
    const tags = parseTagNames(post);
    const voted = state.votedPosts.has(post.id);

    return \`
    <div class="max-w-3xl mx-auto px-4 py-6">
      <!-- Back button -->
      <a href="#" onclick="navigate('board')" class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <i class="fas fa-arrow-left text-xs"></i> Back to all ideas
      </a>

      <!-- Post -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div class="flex gap-4">
          <!-- Vote -->
          <div class="flex-shrink-0" onclick="event.stopPropagation()">
            <button class="vote-btn \${voted ? 'voted' : ''} flex flex-col items-center justify-center w-16 h-20 rounded-xl border-2 \${voted ? 'border-indigo-500 bg-indigo-500' : 'border-gray-200 hover:border-indigo-400'} transition-all"
              onclick="vote(\${post.id}, state.userName, state.userEmail)">
              <i class="fas fa-chevron-up \${voted ? 'text-white' : 'text-gray-500'}"></i>
              <span class="vote-count text-xl font-bold mt-1 \${voted ? 'text-white' : 'text-gray-700'}">\${post.vote_count}</span>
              <span class="text-xs \${voted ? 'text-indigo-100' : 'text-gray-400'}">vote\${post.vote_count !== 1 ? 's' : ''}</span>
            </button>
          </div>
          <!-- Content -->
          <div class="flex-1">
            <div class="flex flex-wrap gap-2 mb-3">
              \${post.is_pinned ? '<span class="badge bg-yellow-100 text-yellow-700"><i class="fas fa-thumbtack text-xs"></i> Pinned</span>' : ''}
              \${post.status_name ? \`<span class="badge" style="background:\${post.status_color}20; color:\${post.status_color}"><span class="w-2 h-2 rounded-full inline-block mr-1" style="background:\${post.status_color}"></span>\${escapeHtml(post.status_name)}</span>\` : ''}
              \${tags.map(t => \`<span class="tag-badge" style="background:\${t.color}20; color:\${t.color}">\${escapeHtml(t.name)}</span>\`).join('')}
            </div>
            <h1 class="text-2xl font-bold text-gray-900 mb-2">\${escapeHtml(post.title)}</h1>
            \${post.content ? \`<div class="text-gray-600 whitespace-pre-wrap text-sm leading-relaxed">\${escapeHtml(post.content)}</div>\` : ''}
            \${post.eta ? \`<div class="mt-3 flex items-center gap-2 text-sm text-indigo-600"><i class="fas fa-calendar"></i><span>ETA: \${escapeHtml(post.eta)}</span></div>\` : ''}
            \${post.changelog_url ? \`<div class="mt-2"><a href="\${escapeHtml(post.changelog_url)}" class="text-sm text-indigo-600 hover:underline"><i class="fas fa-external-link-alt mr-1"></i>View in Changelog</a></div>\` : ''}
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-gray-100 flex items-center text-sm text-gray-400 gap-4">
          <span>by <strong class="text-gray-600">\${escapeHtml(post.author_name)}</strong></span>
          <span><i class="far fa-clock mr-1"></i>\${formatDate(post.created_at)}</span>
          \${state.admin ? \`
            <button onclick="openAdminPost(\${post.id})" class="ml-auto text-indigo-600 hover:text-indigo-800 font-medium">
              <i class="fas fa-edit mr-1"></i>Edit
            </button>
          \` : ''}
        </div>
      </div>

      <!-- Comments -->
      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <h3 class="font-semibold text-gray-900 mb-4">\${state.comments.length} Comment\${state.comments.length !== 1 ? 's' : ''}</h3>
        \${state.comments.map(c => \`
          <div class="mb-4 pb-4 border-b border-gray-100 last:border-0 last:mb-0 last:pb-0">
            <div class="flex items-center gap-2 mb-1">
              <div class="w-8 h-8 rounded-full \${c.is_admin ? 'bg-indigo-600' : 'bg-gray-200'} flex items-center justify-center text-xs font-bold \${c.is_admin ? 'text-white' : 'text-gray-600'}">
                \${escapeHtml(c.author_name.charAt(0).toUpperCase())}
              </div>
              <span class="font-medium text-gray-900 text-sm">\${escapeHtml(c.author_name)}</span>
              \${c.is_admin ? '<span class="admin-badge badge text-xs"><i class="fas fa-shield-alt"></i> Team</span>' : ''}
              <span class="text-gray-400 text-xs ml-auto">\${formatDate(c.created_at)}</span>
              \${state.admin ? \`<button onclick="deleteComment(\${c.id})" class="text-gray-300 hover:text-red-500 text-xs"><i class="fas fa-trash"></i></button>\` : ''}
            </div>
            <div class="ml-10 text-gray-600 text-sm whitespace-pre-wrap">\${escapeHtml(c.content)}</div>
          </div>
        \`).join('')}

        <!-- Add comment form -->
        <div class="mt-4 pt-4 border-t border-gray-100">
          <h4 class="text-sm font-medium text-gray-700 mb-3">Leave a comment</h4>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <input type="text" id="comment-name" placeholder="Your name *" value="\${escapeHtml(state.userName)}"
              class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="email" id="comment-email" placeholder="Email (optional)" value="\${escapeHtml(state.userEmail)}"
              class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <textarea id="comment-content" placeholder="Share your thoughts..." rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-2"></textarea>
          <button onclick="submitComment()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            Post Comment
          </button>
        </div>
      </div>
    </div>
    \`;
  }

  // ============================================================
  // ROADMAP VIEW
  // ============================================================
  function renderRoadmap() {
    const grouped = {};
    state.statuses.forEach(s => {
      grouped[s.name] = { status: s, posts: state.posts.filter(p => p.status_name === s.name) };
    });

    return \`
    <div class="max-w-6xl mx-auto px-4 py-6">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Roadmap</h1>
        <p class="text-gray-500 mt-1">See what's planned, in progress, and recently completed.</p>
      </div>
      <div class="flex gap-4 overflow-x-auto pb-4">
        \${Object.values(grouped).map(({ status, posts }) => \`
          <div class="roadmap-column bg-white rounded-xl border border-gray-200 flex-shrink-0">
            <div class="p-4 border-b border-gray-100 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full" style="background:\${status.color}"></span>
                <span class="font-semibold text-gray-900">\${escapeHtml(status.name)}</span>
              </div>
              <span class="text-sm font-medium text-gray-400">\${posts.length}</span>
            </div>
            <div class="p-3 space-y-2">
              \${posts.length === 0 ? '<p class="text-sm text-gray-400 text-center py-4">No items</p>' :
                posts.map(post => \`
                <div class="p-3 rounded-lg border border-gray-100 hover:border-indigo-300 cursor-pointer transition-all" onclick="openPost(\${post.id})">
                  <div class="flex justify-between items-start gap-2 mb-1">
                    <p class="text-sm font-medium text-gray-900 leading-snug">\${escapeHtml(post.title)}</p>
                    <span class="flex-shrink-0 flex items-center gap-1 text-xs text-gray-400"><i class="fas fa-chevron-up"></i>\${post.vote_count}</span>
                  </div>
                  \${post.eta ? \`<p class="text-xs text-indigo-600"><i class="fas fa-calendar mr-1"></i>\${escapeHtml(post.eta)}</p>\` : ''}
                </div>
              \`).join('')}
            </div>
          </div>
        \`).join('')}
      </div>
    </div>
    \`;
  }

  // ============================================================
  // CHANGELOG VIEW
  // ============================================================
  function renderChangelog() {
    return \`
    <div class="max-w-2xl mx-auto px-4 py-6">
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-gray-900">Changelog</h1>
        <p class="text-gray-500 mt-1">All the latest updates, improvements, and fixes.</p>
      </div>
      \${state.changelog.length === 0 ? \`
        <div class="text-center py-16 text-gray-400">
          <i class="fas fa-scroll text-4xl mb-3"></i>
          <p>No changelog entries yet.</p>
        </div>
      \` : state.changelog.map(entry => {
        const tags = entry.tags ? entry.tags.split(',').filter(Boolean) : [];
        return \`
        <div class="mb-8 pb-8 border-b border-gray-200 last:border-0">
          <div class="flex items-start gap-4">
            <div class="w-2 h-2 rounded-full bg-indigo-500 mt-3 flex-shrink-0"></div>
            <div class="flex-1">
              <div class="flex items-center gap-2 flex-wrap mb-2">
                \${tags.map(tag => \`<span class="tag-badge bg-indigo-50 text-indigo-600">\${escapeHtml(tag.trim())}</span>\`).join('')}
                <span class="text-xs text-gray-400 ml-auto">\${formatDate(entry.published_at || entry.created_at)}</span>
              </div>
              <h2 class="text-xl font-bold text-gray-900 mb-3">\${escapeHtml(entry.title)}</h2>
              <div class="prose prose-sm max-w-none text-gray-600" id="changelog-\${entry.id}"></div>
              <script>
                try {
                  document.getElementById('changelog-\${entry.id}').innerHTML = marked.parse(\${JSON.stringify(entry.content || '')});
                } catch(e) {
                  document.getElementById('changelog-\${entry.id}').textContent = \${JSON.stringify(entry.content || '')};
                }
              <\\/script>
            </div>
          </div>
        </div>
        \`;
      }).join('')}
    </div>
    \`;
  }

  // ============================================================
  // MODALS
  // ============================================================
  function renderNewPostModal() {
    return \`
    <div id="new-post-modal" class="hidden fixed inset-0 bg-black/50 modal-overlay z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onclick="event.stopPropagation()">
        <div class="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 class="text-lg font-bold text-gray-900">Submit an Idea</h2>
          <button onclick="hideModal('new-post-modal')" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Title <span class="text-red-500">*</span></label>
            <input type="text" id="post-title" placeholder="Short, descriptive title..." 
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea id="post-content" placeholder="Describe your idea in detail..." rows="4"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Your name <span class="text-red-500">*</span></label>
              <input type="text" id="post-author-name" placeholder="Name" value="\${escapeHtml(state.userName)}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email (optional)</label>
              <input type="email" id="post-author-email" placeholder="email@example.com" value="\${escapeHtml(state.userEmail)}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          \${state.tags.length > 0 ? \`
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Tags (optional)</label>
            <div class="flex flex-wrap gap-2" id="tag-selector">
              \${state.tags.map(t => \`
                <button type="button" onclick="toggleTag(\${t.id})" id="tag-btn-\${t.id}"
                  class="tag-badge transition-all" style="background:\${t.color}20; color:\${t.color}">
                  \${escapeHtml(t.name)}
                </button>
              \`).join('')}
            </div>
          </div>\` : ''}
        </div>
        <div class="p-6 border-t border-gray-100 flex justify-end gap-2">
          <button onclick="hideModal('new-post-modal')" class="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">Cancel</button>
          <button onclick="submitPost()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            Submit Idea
          </button>
        </div>
      </div>
    </div>
    \`;
  }

  function renderVoteModal() {
    return \`
    <div id="vote-modal" class="hidden fixed inset-0 bg-black/50 modal-overlay z-50 flex items-center justify-center p-4" data-post-id="">
      <div class="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6" onclick="event.stopPropagation()">
        <h2 class="text-lg font-bold text-gray-900 mb-4">Who's voting?</h2>
        <div class="space-y-3">
          <input type="text" id="vote-name" placeholder="Your name *" 
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="email" id="vote-email" placeholder="Email (optional)"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div class="flex gap-2 mt-4">
          <button onclick="hideModal('vote-modal')" class="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          <button onclick="confirmVote()" class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Vote</button>
        </div>
      </div>
    </div>
    \`;
  }

  // ============================================================
  // ADMIN LOGIN
  // ============================================================
  function renderAdminLogin() {
    return \`
    <div class="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div class="text-center mb-6">
          <div class="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <i class="fas fa-shield-alt text-white text-xl"></i>
          </div>
          <h1 class="text-2xl font-bold text-gray-900">Admin Login</h1>
          <p class="text-gray-500 text-sm mt-1">Sign in to manage your board</p>
        </div>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input type="text" id="login-username" placeholder="admin" value="admin"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" id="login-password" placeholder="••••••••" value="admin123"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onkeydown="if(event.key==='Enter')login()" />
          </div>
          <button onclick="login()" class="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 mt-2">
            Sign In
          </button>
        </div>
        <p class="text-center text-xs text-gray-400 mt-4">
          Default: admin / admin123
        </p>
        <p class="text-center mt-4">
          <a href="#" onclick="navigate('board')" class="text-sm text-indigo-600 hover:underline">
            <i class="fas fa-arrow-left mr-1"></i>Back to board
          </a>
        </p>
      </div>
    </div>
    \`;
  }

  // ============================================================
  // ADMIN LAYOUT
  // ============================================================
  function renderAdminLayout() {
    if (!state.admin) return renderAdminLogin();

    const navItems = [
      { key: 'admin', icon: 'fa-tachometer-alt', label: 'Dashboard' },
      { key: 'admin-posts', icon: 'fa-list', label: 'Posts' },
      { key: 'admin-boards', icon: 'fa-columns', label: 'Boards' },
      { key: 'admin-changelog', icon: 'fa-scroll', label: 'Changelog' },
      { key: 'admin-settings', icon: 'fa-cog', label: 'Settings' },
    ];

    let content = '';
    if (state.view === 'admin') content = renderAdminDashboard();
    else if (state.view === 'admin-posts') content = renderAdminPosts();
    else if (state.view === 'admin-post') content = renderAdminPostEdit();
    else if (state.view === 'admin-boards') content = renderAdminBoards();
    else if (state.view === 'admin-changelog') content = renderAdminChangelog();
    else if (state.view === 'admin-settings') content = renderAdminSettings();

    return \`
    <div class="flex min-h-screen bg-gray-50">
      <!-- Sidebar -->
      <aside class="sidebar bg-white border-r border-gray-200 flex flex-col">
        <div class="p-4 border-b border-gray-100">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <i class="fas fa-rocket text-white text-sm"></i>
            </div>
            <div>
              <p class="font-bold text-gray-900 text-sm">FeatureHub</p>
              <p class="text-xs text-gray-400">Admin Panel</p>
            </div>
          </div>
        </div>
        <nav class="flex-1 p-3 space-y-1">
          \${navItems.map(item => \`
            <button onclick="navigate('\${item.key}')" 
              class="sidebar-link w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 \${state.view === item.key || (item.key === 'admin-posts' && state.view === 'admin-post') ? 'active' : 'text-gray-600 hover:bg-gray-50'}">
              <i class="fas \${item.icon} w-4 text-center"></i>
              \${item.label}
            </button>
          \`).join('')}
        </nav>
        <div class="p-3 border-t border-gray-100">
          <div class="flex items-center gap-2 px-3 py-2">
            <div class="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold text-xs">
              \${state.admin.username.charAt(0).toUpperCase()}
            </div>
            <span class="text-sm text-gray-700 flex-1">\${escapeHtml(state.admin.username)}</span>
            <button onclick="logout()" class="text-gray-400 hover:text-red-500 text-xs">
              <i class="fas fa-sign-out-alt"></i>
            </button>
          </div>
          <a href="#" onclick="navigate('board')" class="block mt-1 px-3 py-1.5 text-xs text-gray-500 hover:text-indigo-600">
            <i class="fas fa-external-link-alt mr-1"></i>View Public Board
          </a>
        </div>
      </aside>
      <!-- Main -->
      <main class="flex-1 overflow-auto">
        \${content}
      </main>
    </div>
    \`;
  }

  // ============================================================
  // ADMIN DASHBOARD
  // ============================================================
  function renderAdminDashboard() {
    const { posts, votes, comments, boards, recentPosts } = state.stats;
    const statCards = [
      { label: 'Total Posts', value: posts || 0, icon: 'fa-lightbulb', color: 'indigo' },
      { label: 'Total Votes', value: votes || 0, icon: 'fa-chevron-up', color: 'green' },
      { label: 'Comments', value: comments || 0, icon: 'fa-comments', color: 'blue' },
      { label: 'Boards', value: boards || 0, icon: 'fa-columns', color: 'purple' },
    ];
    const colors = { indigo: 'bg-indigo-50 text-indigo-600', green: 'bg-green-50 text-green-600', blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600' };

    return \`
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p class="text-gray-500">Welcome back, \${escapeHtml(state.admin?.username || '')}!</p>
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        \${statCards.map(card => \`
          <div class="bg-white rounded-xl border border-gray-200 p-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm text-gray-500">\${card.label}</span>
              <div class="w-8 h-8 rounded-lg \${colors[card.color]} flex items-center justify-center">
                <i class="fas \${card.icon} text-sm"></i>
              </div>
            </div>
            <p class="text-2xl font-bold text-gray-900">\${card.value}</p>
          </div>
        \`).join('')}
      </div>
      <!-- Recent Posts -->
      <div class="bg-white rounded-xl border border-gray-200">
        <div class="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Recent Posts</h2>
          <button onclick="navigate('admin-posts')" class="text-sm text-indigo-600 hover:underline">View all</button>
        </div>
        \${(recentPosts || []).map(post => \`
          <div class="px-4 py-3 border-b border-gray-50 last:border-0 flex items-center gap-3 hover:bg-gray-50 cursor-pointer" onclick="openAdminPost(\${post.id})">
            <div class="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <i class="fas fa-lightbulb text-indigo-500 text-xs"></i>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">\${escapeHtml(post.title)}</p>
              <p class="text-xs text-gray-400">\${formatDate(post.created_at)}</p>
            </div>
            <div class="flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
              \${post.status_name ? \`<span class="badge" style="background:#f3f4f6; color:#374151">\${escapeHtml(post.status_name)}</span>\` : ''}
              <span><i class="fas fa-chevron-up mr-1"></i>\${post.vote_count}</span>
            </div>
          </div>
        \`).join('') || '<p class="p-4 text-sm text-gray-400">No posts yet.</p>'}
      </div>
    </div>
    \`;
  }

  // ============================================================
  // ADMIN POSTS
  // ============================================================
  function renderAdminPosts() {
    return \`
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Posts</h1>
          <p class="text-gray-500">Manage all feature requests</p>
        </div>
      </div>
      <!-- Filters -->
      <div class="flex gap-3 mb-4 flex-wrap">
        <div class="relative flex-1 min-w-48">
          <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
          <input type="text" id="admin-search" placeholder="Search posts..." value="\${escapeHtml(state.filters.search)}"
            class="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <select id="admin-status-filter" class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none bg-white">
          <option value="all">All Status</option>
          \${state.statuses.map(s => \`<option value="\${escapeHtml(s.name)}" \${state.filters.status === s.name ? 'selected' : ''}>\${escapeHtml(s.name)}</option>\`).join('')}
        </select>
      </div>
      <!-- Posts Table -->
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Author</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Status</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Votes</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Date</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            \${state.posts.length === 0 ? \`
              <tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No posts found</td></tr>
            \` : state.posts.map(post => \`
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    \${post.is_pinned ? '<i class="fas fa-thumbtack text-yellow-500 text-xs"></i>' : ''}
                    <span class="font-medium text-gray-900">\${escapeHtml(post.title.slice(0, 50))}\${post.title.length > 50 ? '...' : ''}</span>
                  </div>
                </td>
                <td class="px-4 py-3 text-gray-500 hidden md:table-cell">\${escapeHtml(post.author_name)}</td>
                <td class="px-4 py-3 hidden sm:table-cell">
                  \${post.status_name ? \`<span class="badge text-xs" style="background:\${post.status_color}20; color:\${post.status_color}">\${escapeHtml(post.status_name)}</span>\` : '<span class="text-gray-400 text-xs">—</span>'}
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="font-bold text-gray-900">\${post.vote_count}</span>
                </td>
                <td class="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">\${formatDate(post.created_at)}</td>
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <button onclick="openAdminPost(\${post.id})" class="p-1.5 hover:bg-indigo-50 rounded text-indigo-600 hover:text-indigo-800">
                      <i class="fas fa-edit text-xs"></i>
                    </button>
                    <button onclick="deletePost(\${post.id})" class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-600">
                      <i class="fas fa-trash text-xs"></i>
                    </button>
                  </div>
                </td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    \`;
  }

  // ============================================================
  // ADMIN POST EDIT
  // ============================================================
  function renderAdminPostEdit() {
    const post = state.currentPost;
    if (!post) return '<div class="p-8 text-gray-400">Post not found</div>';
    const postTags = post.tag_ids ? post.tag_ids.split(',').map(Number) : [];

    return \`
    <div class="p-6 max-w-2xl">
      <div class="flex items-center gap-3 mb-6">
        <button onclick="navigate('admin-posts')" class="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
          <i class="fas fa-arrow-left"></i>
        </button>
        <div>
          <h1 class="text-xl font-bold text-gray-900">Edit Post</h1>
          <p class="text-gray-500 text-sm">by \${escapeHtml(post.author_name)}</p>
        </div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input type="text" id="edit-title" value="\${escapeHtml(post.title)}"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea id="edit-content" rows="5"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none">\${escapeHtml(post.content || '')}</textarea>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select id="edit-status" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              <option value="">No status</option>
              \${state.statuses.map(s => \`<option value="\${s.id}" \${post.status_id == s.id ? 'selected' : ''}>\${escapeHtml(s.name)}</option>\`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">ETA</label>
            <input type="text" id="edit-eta" placeholder="e.g. Q2 2025" value="\${escapeHtml(post.eta || '')}"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Changelog URL</label>
          <input type="text" id="edit-changelog-url" placeholder="https://..." value="\${escapeHtml(post.changelog_url || '')}"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="edit-pinned" \${post.is_pinned ? 'checked' : ''} class="rounded text-indigo-600" />
            <span class="text-sm font-medium text-gray-700">Pin this post to top</span>
          </label>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Tags</label>
          <div class="flex flex-wrap gap-2">
            \${state.tags.map(t => \`
              <button type="button" onclick="toggleEditTag(\${t.id})" id="edit-tag-btn-\${t.id}"
                class="tag-badge transition-all \${postTags.includes(t.id) ? 'ring-2' : ''}" style="background:\${t.color}20; color:\${t.color}; \${postTags.includes(t.id) ? 'ring-color:' + t.color + '; outline: 2px solid ' + t.color : ''}">
                \${escapeHtml(t.name)}
              </button>
            \`).join('')}
          </div>
        </div>
        <div class="flex justify-between pt-2">
          <button onclick="deletePost(\${post.id})" class="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium">
            <i class="fas fa-trash mr-1"></i>Delete Post
          </button>
          <button onclick="savePost(\${post.id})" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            <i class="fas fa-save mr-1"></i>Save Changes
          </button>
        </div>
      </div>

      <!-- Admin Comment -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 mt-4">
        <h3 class="font-semibold text-gray-900 mb-3">Post Admin Comment</h3>
        <textarea id="admin-comment" placeholder="Leave an official update..." rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-2"></textarea>
        <button onclick="postAdminComment(\${post.id})" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          Post as Admin
        </button>
      </div>

      <!-- Comments list -->
      \${state.comments.length > 0 ? \`
      <div class="bg-white rounded-xl border border-gray-200 p-6 mt-4">
        <h3 class="font-semibold text-gray-900 mb-3">Comments (\${state.comments.length})</h3>
        \${state.comments.map(c => \`
          <div class="flex items-start gap-3 mb-3 pb-3 border-b border-gray-100 last:border-0">
            <div class="w-7 h-7 rounded-full \${c.is_admin ? 'bg-indigo-600' : 'bg-gray-100'} flex-shrink-0 flex items-center justify-center text-xs font-bold \${c.is_admin ? 'text-white' : 'text-gray-500'}">
              \${c.author_name.charAt(0).toUpperCase()}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 mb-0.5">
                <span class="text-sm font-medium text-gray-900">\${escapeHtml(c.author_name)}</span>
                \${c.is_admin ? '<span class="admin-badge badge text-xs">Team</span>' : ''}
                <span class="text-xs text-gray-400 ml-auto">\${formatDate(c.created_at)}</span>
              </div>
              <p class="text-sm text-gray-600">\${escapeHtml(c.content)}</p>
            </div>
            <button onclick="deleteComment(\${c.id})" class="text-gray-300 hover:text-red-500 text-xs flex-shrink-0">
              <i class="fas fa-times"></i>
            </button>
          </div>
        \`).join('')}
      </div>\` : ''}
    </div>
    \`;
  }

  // ============================================================
  // ADMIN BOARDS
  // ============================================================
  function renderAdminBoards() {
    return \`
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Boards</h1>
          <p class="text-gray-500">Manage your feedback boards</p>
        </div>
        <button onclick="showCreateBoardModal()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          <i class="fas fa-plus mr-1"></i>New Board
        </button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        \${state.boards.map(board => \`
          <div class="bg-white rounded-xl border border-gray-200 p-5">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style="background:\${board.color}">
                \${board.name.charAt(0)}
              </div>
              <div>
                <h3 class="font-semibold text-gray-900">\${escapeHtml(board.name)}</h3>
                <p class="text-xs text-gray-400">/\${escapeHtml(board.slug)}</p>
              </div>
            </div>
            \${board.description ? \`<p class="text-sm text-gray-500 mb-3 line-clamp-2">\${escapeHtml(board.description)}</p>\` : ''}
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-400"><i class="fas fa-lightbulb mr-1"></i>\${board.post_count || 0} posts</span>
              <div class="flex gap-1">
                <button onclick="navigate('board')" class="p-1.5 hover:bg-gray-100 rounded text-gray-500 text-xs">
                  <i class="fas fa-external-link-alt"></i>
                </button>
                <button onclick="deleteBoard(\${board.id})" class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 text-xs">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        \`).join('')}
      </div>
    </div>
    <!-- Create Board Modal -->
    <div id="create-board-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6" onclick="event.stopPropagation()">
        <h2 class="text-lg font-bold text-gray-900 mb-4">Create New Board</h2>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" id="board-name" placeholder="e.g. Product Feedback" 
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <input type="text" id="board-slug" placeholder="e.g. product-feedback"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea id="board-description" rows="2" placeholder="Describe what this board is for..."
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <input type="color" id="board-color" value="#6366f1" class="h-9 w-full rounded-lg border border-gray-300 cursor-pointer" />
          </div>
        </div>
        <div class="flex gap-2 mt-4">
          <button onclick="hideModal('create-board-modal')" class="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg text-sm">Cancel</button>
          <button onclick="createBoard()" class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Create</button>
        </div>
      </div>
    </div>
    \`;
  }

  // ============================================================
  // ADMIN CHANGELOG
  // ============================================================
  function renderAdminChangelog() {
    return \`
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Changelog</h1>
          <p class="text-gray-500">Manage your release notes</p>
        </div>
        <button onclick="showCreateChangelogModal()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          <i class="fas fa-plus mr-1"></i>New Entry
        </button>
      </div>
      <div class="space-y-3">
        \${state.changelog.map(entry => \`
          <div class="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-4">
            <div class="w-2 h-2 rounded-full mt-2 flex-shrink-0 \${entry.published ? 'bg-green-500' : 'bg-gray-300'}"></div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h3 class="font-semibold text-gray-900">\${escapeHtml(entry.title)}</h3>
                  <p class="text-xs text-gray-400 mt-0.5">\${entry.published ? '<span class="text-green-600">Published</span> · ' : '<span class="text-gray-400">Draft</span> · '}\${formatDate(entry.published_at || entry.created_at)}</p>
                </div>
                <div class="flex gap-1 flex-shrink-0">
                  <button onclick="editChangelogEntry(\${entry.id})" class="p-1.5 hover:bg-indigo-50 rounded text-indigo-600 text-xs">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button onclick="deleteChangelogEntry(\${entry.id})" class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 text-xs">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        \`).join('') || '<div class="text-center py-8 text-gray-400">No changelog entries yet.</div>'}
      </div>
    </div>
    <!-- Create/Edit Changelog Modal -->
    <div id="changelog-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-edit-id="">
      <div class="bg-white rounded-2xl w-full max-w-xl shadow-2xl p-6" onclick="event.stopPropagation()">
        <h2 id="changelog-modal-title" class="text-lg font-bold text-gray-900 mb-4">New Changelog Entry</h2>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input type="text" id="cl-title" placeholder="What's new in this release?"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Content (Markdown supported)</label>
            <textarea id="cl-content" rows="6" placeholder="Describe the changes..."
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Tags (comma separated)</label>
            <input type="text" id="cl-tags" placeholder="e.g. feature, improvement, bug-fix"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" id="cl-published" class="rounded text-indigo-600" />
            <span class="text-sm text-gray-700">Publish immediately</span>
          </label>
        </div>
        <div class="flex gap-2 mt-4">
          <button onclick="hideModal('changelog-modal')" class="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg text-sm">Cancel</button>
          <button onclick="saveChangelogEntry()" class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Save</button>
        </div>
      </div>
    </div>
    \`;
  }

  // ============================================================
  // ADMIN SETTINGS
  // ============================================================
  function renderAdminSettings() {
    return \`
    <div class="p-6 max-w-xl">
      <h1 class="text-2xl font-bold text-gray-900 mb-6">Settings</h1>
      
      <!-- Change Password -->
      <div class="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h2 class="font-semibold text-gray-900 mb-4">Change Password</h2>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input type="password" id="cur-password" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input type="password" id="new-password" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onclick="changePassword()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            Update Password
          </button>
        </div>
      </div>

      <!-- Tags Management -->
      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <h2 class="font-semibold text-gray-900 mb-4">Manage Tags</h2>
        <div class="flex flex-wrap gap-2 mb-4">
          \${state.tags.map(t => \`
            <span class="tag-badge flex items-center gap-1" style="background:\${t.color}20; color:\${t.color}">
              \${escapeHtml(t.name)}
              <button onclick="deleteTag(\${t.id})" class="hover:text-red-500 ml-1">×</button>
            </span>
          \`).join('')}
        </div>
        <div class="flex gap-2">
          <input type="text" id="new-tag-name" placeholder="Tag name"
            class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="color" id="new-tag-color" value="#6366f1" class="h-9 w-14 rounded-lg border border-gray-300 cursor-pointer" />
          <button onclick="createTag()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Add</button>
        </div>
      </div>
    </div>
    \`;
  }

  // ============================================================
  // EVENT HANDLERS & ACTIONS
  // ============================================================
  function bindEvents() {
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      let t;
      searchInput.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => { state.filters.search = e.target.value; loadAndRender(); }, 400);
      });
    }

    // Sort
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', e => { state.filters.sort = e.target.value; loadAndRender(); });
    }

    // Admin search
    const adminSearch = document.getElementById('admin-search');
    if (adminSearch) {
      let t;
      adminSearch.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => { state.filters.search = e.target.value; loadAndRender(); }, 400);
      });
    }

    const adminStatusFilter = document.getElementById('admin-status-filter');
    if (adminStatusFilter) {
      adminStatusFilter.addEventListener('change', e => { state.filters.status = e.target.value; loadAndRender(); });
    }

    // Board name slug auto-fill
    const boardName = document.getElementById('board-name');
    const boardSlug = document.getElementById('board-slug');
    if (boardName && boardSlug) {
      boardName.addEventListener('input', e => { boardSlug.value = slugify(e.target.value); });
    }

    // Close modals on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => { if (e.target === el) hideModal(el.id); });
    });
  }

  function filterStatus(status) {
    state.filters.status = status;
    loadAndRender();
  }

  function filterTag(tag) {
    state.filters.tag = state.filters.tag === tag ? '' : tag;
    loadAndRender();
  }

  function showNewPostModal() {
    const modal = document.getElementById('new-post-modal');
    if (modal) {
      modal.classList.remove('hidden');
      window._selectedTags = [];
    }
  }

  function hideModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  function toggleTag(tagId) {
    if (!window._selectedTags) window._selectedTags = [];
    const btn = document.getElementById('tag-btn-' + tagId);
    const tag = state.tags.find(t => t.id === tagId);
    if (!tag) return;
    const idx = window._selectedTags.indexOf(tagId);
    if (idx === -1) {
      window._selectedTags.push(tagId);
      btn.style.outline = '2px solid ' + tag.color;
    } else {
      window._selectedTags.splice(idx, 1);
      btn.style.outline = 'none';
    }
  }

  function toggleEditTag(tagId) {
    if (!window._editTags) window._editTags = [];
    const btn = document.getElementById('edit-tag-btn-' + tagId);
    const tag = state.tags.find(t => t.id === tagId);
    if (!tag) return;
    const idx = window._editTags.indexOf(tagId);
    if (idx === -1) {
      window._editTags.push(tagId);
      btn.style.outline = '2px solid ' + tag.color;
    } else {
      window._editTags.splice(idx, 1);
      btn.style.outline = 'none';
    }
  }

  async function submitPost() {
    const title = document.getElementById('post-title')?.value?.trim();
    const content = document.getElementById('post-content')?.value?.trim();
    const author_name = document.getElementById('post-author-name')?.value?.trim();
    const author_email = document.getElementById('post-author-email')?.value?.trim();

    if (!title) { toast('Please enter a title', 'error'); return; }
    if (!author_name) { toast('Please enter your name', 'error'); return; }

    // Remember user info
    state.userName = author_name;
    state.userEmail = author_email;
    localStorage.setItem('userName', author_name);
    localStorage.setItem('userEmail', author_email);

    try {
      await api('post', '/posts', {
        board_id: state.currentBoard?.id || 1,
        title, content, author_name, author_email,
        tags: window._selectedTags || []
      });
      hideModal('new-post-modal');
      toast('Your idea has been submitted!', 'success');
      await loadPosts();
      render();
    } catch(e) {}
  }

  async function confirmVote() {
    const name = document.getElementById('vote-name')?.value?.trim();
    const email = document.getElementById('vote-email')?.value?.trim();
    const modal = document.getElementById('vote-modal');
    const postId = parseInt(modal?.dataset.postId);

    if (!name) { toast('Please enter your name', 'error'); return; }

    state.userName = name;
    state.userEmail = email;
    localStorage.setItem('userName', name);
    localStorage.setItem('userEmail', email);

    hideModal('vote-modal');
    await vote(postId, name, email);
  }

  async function openPost(id) {
    state.loading = true;
    state.view = 'post';
    render();
    await loadPost(id);
    state.loading = false;
    render();
    window.scrollTo(0, 0);
  }

  async function openAdminPost(id) {
    state.view = 'admin-post';
    await loadPost(id);
    window._editTags = state.currentPost?.tag_ids ? state.currentPost.tag_ids.split(',').map(Number) : [];
    render();
    window.scrollTo(0, 0);
  }

  async function submitComment() {
    const name = document.getElementById('comment-name')?.value?.trim();
    const email = document.getElementById('comment-email')?.value?.trim();
    const content = document.getElementById('comment-content')?.value?.trim();

    if (!content) { toast('Please enter a comment', 'error'); return; }
    if (!name) { toast('Please enter your name', 'error'); return; }

    state.userName = name;
    state.userEmail = email;
    localStorage.setItem('userName', name);
    localStorage.setItem('userEmail', email);

    try {
      await api('post', \`/posts/\${state.currentPost.id}/comments\`, { author_name: name, author_email: email, content });
      state.comments.push({ author_name: name, content, is_admin: 0, created_at: new Date().toISOString() });
      toast('Comment posted!', 'success');
      render();
    } catch(e) {}
  }

  async function deleteComment(commentId) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api('delete', \`/posts/\${state.currentPost?.id}/comments/\${commentId}\`);
      state.comments = state.comments.filter(c => c.id !== commentId);
      toast('Comment deleted', 'success');
      render();
    } catch(e) {}
  }

  async function savePost(postId) {
    const title = document.getElementById('edit-title')?.value?.trim();
    const content = document.getElementById('edit-content')?.value?.trim();
    const status_id = document.getElementById('edit-status')?.value || null;
    const eta = document.getElementById('edit-eta')?.value?.trim();
    const changelog_url = document.getElementById('edit-changelog-url')?.value?.trim();
    const is_pinned = document.getElementById('edit-pinned')?.checked;

    try {
      await api('put', \`/posts/\${postId}\`, {
        title, content, status_id: status_id || null, is_pinned, eta, changelog_url,
        tags: window._editTags || []
      });
      toast('Post updated!', 'success');
      await loadPosts();
      navigate('admin-posts');
    } catch(e) {}
  }

  async function deletePost(postId) {
    if (!confirm('Delete this post and all its comments?')) return;
    try {
      await api('delete', \`/posts/\${postId}\`);
      toast('Post deleted', 'success');
      state.posts = state.posts.filter(p => p.id !== postId);
      navigate('admin-posts');
    } catch(e) {}
  }

  async function postAdminComment(postId) {
    const content = document.getElementById('admin-comment')?.value?.trim();
    if (!content) { toast('Please enter a comment', 'error'); return; }
    try {
      await api('post', \`/posts/\${postId}/comments\`, {
        author_name: state.admin.username,
        author_email: state.admin.email,
        content,
        is_admin: true
      });
      toast('Admin comment posted!', 'success');
      await loadPost(postId);
      render();
    } catch(e) {}
  }

  async function login() {
    const username = document.getElementById('login-username')?.value?.trim();
    const password = document.getElementById('login-password')?.value?.trim();
    try {
      const data = await api('post', '/auth/login', { username, password });
      state.admin = data.admin;
      toast('Welcome back, ' + data.admin.username + '!', 'success');
      await loadStats();
      navigate('admin');
    } catch(e) {}
  }

  async function logout() {
    try {
      await api('post', '/auth/logout');
      state.admin = null;
      toast('Logged out', 'info');
      navigate('board');
    } catch(e) {}
  }

  async function createBoard() {
    const name = document.getElementById('board-name')?.value?.trim();
    const slug = document.getElementById('board-slug')?.value?.trim();
    const description = document.getElementById('board-description')?.value?.trim();
    const color = document.getElementById('board-color')?.value;

    if (!name || !slug) { toast('Name and slug are required', 'error'); return; }

    try {
      await api('post', '/boards', { name, slug, description, color });
      toast('Board created!', 'success');
      hideModal('create-board-modal');
      await loadBoards();
      render();
    } catch(e) {}
  }

  async function deleteBoard(id) {
    if (!confirm('Delete this board and all its posts?')) return;
    try {
      await api('delete', \`/boards/\${id}\`);
      toast('Board deleted', 'success');
      await loadBoards();
      render();
    } catch(e) {}
  }

  function showCreateBoardModal() {
    document.getElementById('create-board-modal')?.classList.remove('hidden');
  }

  function showCreateChangelogModal() {
    const modal = document.getElementById('changelog-modal');
    if (modal) {
      modal.dataset.editId = '';
      document.getElementById('changelog-modal-title').textContent = 'New Changelog Entry';
      document.getElementById('cl-title').value = '';
      document.getElementById('cl-content').value = '';
      document.getElementById('cl-tags').value = '';
      document.getElementById('cl-published').checked = false;
      modal.classList.remove('hidden');
    }
  }

  function editChangelogEntry(id) {
    const entry = state.changelog.find(e => e.id === id);
    if (!entry) return;
    const modal = document.getElementById('changelog-modal');
    if (modal) {
      modal.dataset.editId = id;
      document.getElementById('changelog-modal-title').textContent = 'Edit Changelog Entry';
      document.getElementById('cl-title').value = entry.title;
      document.getElementById('cl-content').value = entry.content;
      document.getElementById('cl-tags').value = entry.tags || '';
      document.getElementById('cl-published').checked = !!entry.published;
      modal.classList.remove('hidden');
    }
  }

  async function saveChangelogEntry() {
    const modal = document.getElementById('changelog-modal');
    const editId = modal?.dataset.editId;
    const title = document.getElementById('cl-title')?.value?.trim();
    const content = document.getElementById('cl-content')?.value?.trim();
    const tags = document.getElementById('cl-tags')?.value?.trim();
    const published = document.getElementById('cl-published')?.checked;

    if (!title || !content) { toast('Title and content are required', 'error'); return; }

    try {
      if (editId) {
        await api('put', \`/changelog/\${editId}\`, { title, content, tags, published });
        toast('Changelog updated!', 'success');
      } else {
        await api('post', '/changelog', { title, content, tags, published });
        toast('Changelog entry created!', 'success');
      }
      hideModal('changelog-modal');
      await loadChangelog(true);
      render();
    } catch(e) {}
  }

  async function deleteChangelogEntry(id) {
    if (!confirm('Delete this changelog entry?')) return;
    try {
      await api('delete', \`/changelog/\${id}\`);
      toast('Entry deleted', 'success');
      await loadChangelog(true);
      render();
    } catch(e) {}
  }

  async function changePassword() {
    const cur = document.getElementById('cur-password')?.value;
    const neu = document.getElementById('new-password')?.value;
    if (!cur || !neu) { toast('Please fill both fields', 'error'); return; }
    try {
      await api('post', '/auth/change-password', { current_password: cur, new_password: neu });
      toast('Password updated!', 'success');
      document.getElementById('cur-password').value = '';
      document.getElementById('new-password').value = '';
    } catch(e) {}
  }

  async function createTag() {
    const name = document.getElementById('new-tag-name')?.value?.trim();
    const color = document.getElementById('new-tag-color')?.value;
    if (!name) { toast('Please enter a tag name', 'error'); return; }
    try {
      await api('post', '/tags', { name, color, board_id: state.currentBoard?.id });
      toast('Tag created!', 'success');
      document.getElementById('new-tag-name').value = '';
      const boardData = await loadBoard(state.currentBoard?.slug || 'product-feedback');
      render();
    } catch(e) {}
  }

  async function deleteTag(id) {
    if (!confirm('Delete this tag?')) return;
    try {
      await api('delete', \`/tags/\${id}\`);
      toast('Tag deleted', 'success');
      await loadBoard(state.currentBoard?.slug || 'product-feedback');
      render();
    } catch(e) {}
  }

  // ============================================================
  // NAVIGATION
  // ============================================================
  async function navigate(view) {
    state.view = view;

    if (view === 'board') {
      state.filters = { status: 'all', sort: 'votes', search: '', tag: '' };
      state.currentPost = null;
      state.loading = true;
      render();
      await loadPosts();
      state.loading = false;
    } else if (view === 'roadmap') {
      if (state.posts.length === 0) await loadPosts();
    } else if (view === 'changelog') {
      await loadChangelog();
    } else if (view === 'admin') {
      await loadStats();
    } else if (view === 'admin-posts') {
      state.filters = { status: 'all', sort: 'votes', search: '', tag: '' };
      state.loading = true;
      render();
      await loadPosts();
      state.loading = false;
    } else if (view === 'admin-boards') {
      await loadBoards();
    } else if (view === 'admin-changelog') {
      await loadChangelog(true);
    }

    render();
    window.scrollTo(0, 0);
  }

  async function loadAndRender() {
    state.loading = true;
    render();
    await loadPosts();
    state.loading = false;
    render();
  }

  // ============================================================
  // APP INIT
  // ============================================================
  async function init() {
    try {
      await checkAuth();
      await loadBoard('product-feedback');
      await loadPosts();
      render();
    } catch(e) {
      console.error('Init error:', e);
      render();
    }
  }

  init();
  </script>
</body>
</html>`;
}

export default app
