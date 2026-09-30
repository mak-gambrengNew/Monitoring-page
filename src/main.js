import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  document.body.innerHTML = '<div style="padding:24px;font-family:Arial;color:#fff;background:#06090d;min-height:100vh">Konfigurasi Supabase belum tersedia. Isi <b>VITE_SUPABASE_URL</b> dan <b>VITE_SUPABASE_PUBLISHABLE_KEY</b> pada environment Vercel.</div>'
  throw new Error('Missing Supabase environment variables')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})

let stores = []
let transactions = []
let menus = []
let totalSales = 0
let currentFeed = null
let realtimeChannel = null
let refreshTimer = null

const $ = (id) => document.getElementById(id)
const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')
const tm = () => new Date().toLocaleTimeString('id-ID', { hour12: false })
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[ch]))
const emptyState = (message) => `<div class="empty-state">${escapeHtml(message)}</div>`

function setAuthError(message='') {
  const el = $('authError')
  el.textContent = message
  el.classList.toggle('show', !!message)
}

function setLoading(loading) {
  const btn = $('loginBtn')
  btn.disabled = loading
  btn.textContent = loading ? 'MEMERIKSA…' : 'MASUK'
}

function setLoggedIn(user) {
  $('authGate').style.display = 'none'
  document.querySelector('.app').classList.remove('hidden')
  const email = user?.email || ''
  const sub = document.querySelector('.sub')
  if (sub) sub.textContent = email ? `PEMANTAUAN PENJUALAN REALTIME · ${email}` : 'PEMANTAUAN PENJUALAN REALTIME'
}

function setLoggedOut() {
  $('authGate').style.display = 'flex'
  document.querySelector('.app').classList.add('hidden')
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel)
    realtimeChannel = null
  }
}

async function requireOwner(user) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,business_id,role,status,full_name')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw error
  if (!profile || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('Akun ini tidak memiliki akses Owner Monitoring.')
  }
  return profile
}

function normalizeFeed(feed) {
  const details = Array.isArray(feed?.store_details) ? feed.store_details : []
  const menuRows = Array.isArray(feed?.menu_sales) ? feed.menu_sales : []
  const events = Array.isArray(feed?.recent_transactions) ? feed.recent_transactions : []
  const menuMap = new Map()

  for (const row of menuRows) {
    const key = row.menu_id || row.menu_name || crypto.randomUUID()
    const prev = menuMap.get(key) || { name: row.menu_name || 'Menu', qty: 0, total: 0 }
    prev.qty += Number(row.quantity) || 0
    prev.total += Number(row.amount) || 0
    menuMap.set(key, prev)
  }

  const sessions = Array.isArray(feed?.operation_sessions) ? feed.operation_sessions : []
  const sessionMap = new Map()
  for (const session of sessions) {
    if (!sessionMap.has(session.store_id)) sessionMap.set(session.store_id, session)
  }

  stores = details.map(store => {
    const session = sessionMap.get(store.store_id)
    const storeMenus = menuRows
      .filter(row => row.store_id === store.store_id)
      .map(row => ({ name: row.menu_name, qty: Number(row.quantity) || 0, total: Number(row.amount) || 0, unitPrice: 0 }))
    return {
      id: store.store_id,
      name: store.name,
      open: store.operational_status === 'open',
      start: store.opened_at ? new Date(store.opened_at).toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'}) : '--:--',
      sales: Number(store.total_sales) || 0,
      orders: Number(store.transaction_count) || 0,
      menus: storeMenus,
      session
    }
  })

  transactions = events.map(event => {
    const firstItem = Array.isArray(event.items) && event.items[0] ? event.items[0] : null
    const store = details.find(s => s.store_id === event.store_id)
    return {
      id: event.id,
      time: event.occurred_at ? new Date(event.occurred_at).toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '--:--:--',
      store: store?.name || 'Gerai',
      menu: firstItem?.name || firstItem?.menu_name || 'Transaksi',
      value: Number(event.total_amount) || 0
    }
  })

  menus = [...menuMap.values()]
  totalSales = Number(feed?.summary?.total_sales) || 0
  currentFeed = feed
}

function render() {
  const active = stores.filter(s => s.open).length
  const closed = stores.length - active
  $('active').textContent = stores.length ? `${active}/${stores.length}` : '--'
  $('closed').textContent = stores.length ? `${closed} gerai tutup` : 'menunggu data backend'
  $('total').textContent = stores.length ? rp(totalSales) : '--'
  $('statusInfo').textContent = stores.length ? `${active} BUKA · ${closed} TUTUP` : 'MENUNGGU DATA BACKEND'

  $('stores').innerHTML = stores.length ? stores.map((s,i) => `
    <article class="store ${s.open ? 'open' : 'closed'}" id="store-${i}" onclick="openDetail(${i})">
      <div class="sh"><div class="name">${escapeHtml(s.name || 'Gerai')}</div><div class="status"><i></i>${s.open ? 'OPEN' : 'CLOSED'}</div></div>
      <div class="sd"><div><div class="sales">${rp(s.sales)}</div><div class="meta">${s.open ? 'Mulai buka' : 'Tutup'} · ${escapeHtml(s.start || '--:--')}</div></div><div class="orders"><b>${Number(s.orders) || 0}</b>transaksi</div></div>
    </article>`).join('') : emptyState('Belum ada data gerai dari backend.')

  const sorted = [...stores].sort((a,b) => (Number(b.sales)||0) - (Number(a.sales)||0))
  const max = sorted.length ? Math.max(...sorted.map(s => Number(s.sales)||0), 1) : 1
  $('ranking').innerHTML = sorted.length ? sorted.map((s,i) => `
    <div class="rank"><div class="no">${String(i+1).padStart(2,'0')}</div><div class="rn">${escapeHtml(s.name || 'Gerai')}</div><div class="rv">${rp(s.sales)}</div><div class="bar"><i style="width:${Math.max(4,(Number(s.sales)||0)/max*100)}%"></i></div></div>`).join('') : emptyState('Belum ada data ranking.')

  $('transactions').innerHTML = transactions.length ? transactions.slice(0,12).map(t => `
    <div class="txn"><span class="tt">${escapeHtml(t.time || '--:--:--')}</span><span class="ts">${escapeHtml(t.store || 'Gerai')} · ${escapeHtml(t.menu || 'Transaksi')}</span><span class="tv">+${rp(t.value)}</span></div>`).join('') : emptyState('Belum ada transaksi terbaru.')
  $('eventCount').textContent = transactions.length ? `${transactions.length} transaksi` : '0'

  const sortedMenus = [...menus].sort((a,b) => (Number(b.qty)||0) - (Number(a.qty)||0))
  $('menus').innerHTML = sortedMenus.length ? sortedMenus.map(m => `<div class="menu"><span class="mn">${escapeHtml(m.name || 'Menu')}</span><span class="mq">${Number(m.qty)||0} terjual</span></div>`).join('') : emptyState('Belum ada data menu.')

  const t = tm()
  $('clock').textContent = t
  $('footClock').textContent = t
}

window.openDetail = function(index) {
  const s = stores[index]
  if (!s) return
  const rows = [...(s.menus || [])].sort((a,b) => (Number(b.total)||0) - (Number(a.total)||0))
  const total = rows.reduce((sum,m) => sum + (Number(m.total)||0), 0)
  $('detailTitle').textContent = s.name || 'Gerai'
  const status = $('detailStatus')
  status.className = 'modal-status ' + (s.open ? '' : 'closed')
  status.innerHTML = `<i></i>${s.open ? 'OPEN' : 'CLOSED'}`
  $('detailSales').textContent = rp(s.sales)
  $('detailOrders').textContent = Number(s.orders) || 0
  $('detailStart').textContent = `${s.open ? 'Mulai buka' : 'Tutup'} · ${s.start || '--:--'}`
  $('detailMenus').innerHTML = rows.length ? rows.map((m,i) => {
    const share = total ? (Number(m.total)||0) / total * 100 : 0
    return `<div class="detail-row"><div class="detail-rank">${String(i+1).padStart(2,'0')}</div><div><div class="detail-name">${escapeHtml(m.name || 'Menu')}</div><div class="detail-money">${rp(m.total)}</div></div><div><div class="detail-qty">${Number(m.qty)||0} unit</div><div class="detail-share">${share.toFixed(0)}%</div></div></div>`
  }).join('') : emptyState('Belum ada rincian menu dari backend.')
  $('detailModal').classList.add('show')
  document.body.style.overflow = 'hidden'
}

window.closeDetail = function(e) {
  if (e && e.target !== $('detailModal')) return
  $('detailModal').classList.remove('show')
  document.body.style.overflow = ''
}

async function loadFeed() {
  const { data, error } = await supabase.functions.invoke('monitoring-feed', { method: 'GET' })
  if (error) throw error
  if (!data || data.error) throw new Error(data?.error || 'Monitoring feed gagal dimuat.')
  normalizeFeed(data)
  render()
  updateRealtimeStatus(true)
}

function scheduleFeedRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    try { await loadFeed() } catch (error) { console.error('[monitoring] refresh failed', error); updateRealtimeStatus(false, error.message) }
  }, 350)
}

function updateRealtimeStatus(ok, message='') {
  const live = document.querySelector('.live')
  if (!live) return
  live.style.color = ok ? 'var(--g)' : 'var(--r)'
  live.innerHTML = `<i></i>${ok ? 'LIVE' : 'OFFLINE'}`
  if (message) $('statusInfo').textContent = message
}

function subscribeRealtime(profile) {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel)
  realtimeChannel = supabase
    .channel(`owner-monitoring:${profile.business_id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'monitoring_sales_events', filter: `business_id=eq.${profile.business_id}` }, scheduleFeedRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_operation_sessions', filter: `business_id=eq.${profile.business_id}` }, scheduleFeedRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'monitoring_store_sales', filter: `business_id=eq.${profile.business_id}` }, scheduleFeedRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'monitoring_menu_sales', filter: `business_id=eq.${profile.business_id}` }, scheduleFeedRefresh)
    .subscribe((status) => {
      updateRealtimeStatus(status === 'SUBSCRIBED')
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') scheduleFeedRefresh()
    })
}

async function startOwnerApp(session) {
  try {
    const profile = await requireOwner(session.user)
    setLoggedIn(session.user)
    await loadFeed()
    subscribeRealtime(profile)
  } catch (error) {
    console.error('[monitoring] startup failed', error)
    await supabase.auth.signOut()
    setLoggedOut()
    setAuthError(error.message || 'Gagal membuka monitoring.')
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  setAuthError('')
  setLoading(true)
  const email = $('email').value.trim()
  const password = $('password').value
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (!data.session) throw new Error('Sesi login tidak terbentuk.')
    await startOwnerApp(data.session)
  } catch (error) {
    setAuthError(error.message || 'Login gagal.')
  } finally {
    setLoading(false)
  }
})

$('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut()
  setLoggedOut()
  setAuthError('')
  $('password').value = ''
})

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    if ($('authGate').style.display !== 'none') startOwnerApp(session)
  } else {
    setLoggedOut()
  }
})

document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeDetail() })
render()
setInterval(() => { const t=tm(); $('clock').textContent=t; $('footClock').textContent=t }, 1000)
