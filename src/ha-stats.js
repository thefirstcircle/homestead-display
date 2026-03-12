/**
 * ha-stats.js — Left panel: site name, quick links, RSS headlines, outside weather.
 *
 * Room temp polling is ready to activate — add config.homeAssistant and
 * call startHAPolling() to populate the HA section.
 */

// ── Config ────────────────────────────────────────────────────────────────────

import { config } from './config.js'
import { setVolume, getVolume } from './ambient-audio.js'

const RSS_FEEDS = [
  { id: 'us',        label: 'US NEWS',    url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml'       },
  { id: 'world',     label: 'WORLD NEWS', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'    },
  { id: 'slashdot',  label: 'SLASHDOT',   url: 'https://rss.slashdot.org/Slashdot/slashdotMain'            },
]

const GH_ICON = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" style="vertical-align:middle;margin-right:4px;display:inline-block"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

const QUICK_LINKS = [
  { label: 'HOME ASSISTANT', href: 'https://ha.bondstreet.dev',                                color: '#ff7043', glow: 'rgba(255,112,67,0.35)'  },
  { label: 'VDI',            href: 'https://vdi.bondstreet.dev/guacamole/#/',                   color: '#29b6f6', glow: 'rgba(41,182,246,0.35)'  },
  { label: 'CODE',           href: 'https://code.bondstreet.dev',                               color: '#66bb6a', glow: 'rgba(102,187,106,0.35)' },
  { label: 'GITHUB',         href: 'https://github.com/thefirstcircle/homestead-display',       color: '#e0e0e0', glow: 'rgba(224,224,224,0.20)', icon: GH_ICON },
]

const HEADLINES_PER_FEED = 5
const RSS_REFRESH_MS     = 30 * 60 * 1000   // 30 min

// ── RSS fetch — tries multiple CORS proxies in order ─────────────────────────

const PROXIES = [
  async (url) => {
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { cache: 'no-store' })
    const { contents } = await res.json()
    return contents
  },
  async (url) => {
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`corsproxy ${res.status}`)
    return await res.text()
  },
  async (url) => {
    const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`codetabs ${res.status}`)
    return await res.text()
  },
]

async function fetchHeadlines(rssUrl) {
  for (const proxy of PROXIES) {
    try {
      const xml = await proxy(rssUrl)
      const doc = new DOMParser().parseFromString(xml, 'text/xml')
      const items = [...doc.querySelectorAll('item')].slice(0, HEADLINES_PER_FEED)
      if (items.length === 0) continue   // malformed — try next proxy
      return items.map(item => ({
        title: item.querySelector('title')?.textContent?.trim() ?? '—',
        link:  item.querySelector('link')?.textContent?.trim()  ?? '#',
      }))
    } catch {
      // try next proxy
    }
  }
  throw new Error('all proxies failed')
}

async function refreshFeed(feedId) {
  const feed = RSS_FEEDS.find(f => f.id === feedId)
  if (!feed) return
  const list = document.getElementById(`rss-${feedId}`)
  if (!list) return

  try {
    const items = await fetchHeadlines(feed.url)
    list.innerHTML = items.map(item => `
      <li class="rss-item">
        <a class="rss-link" href="${item.link}" target="_blank" rel="noopener">${item.title}</a>
      </li>`).join('')
  } catch {
    list.innerHTML = `<li class="rss-item rss-err">— feed unavailable —</li>`
  }
}

function startRSSPolling() {
  // Stagger initial fetches 3 s apart so the CORS proxy isn't hit simultaneously
  RSS_FEEDS.forEach((feed, i) => {
    setTimeout(() => {
      refreshFeed(feed.id)
      setInterval(() => refreshFeed(feed.id), RSS_REFRESH_MS)
    }, i * 3000)
  })
}

// ── Rotary knob ───────────────────────────────────────────────────────────────

function createKnob(initial, onChange) {
  const SIZE = 34
  // Canvas angles (0 = right / 3 o'clock, clockwise positive)
  // 7 o'clock = 120°, 5 o'clock = 60°; sweep 300° clockwise through top
  const MIN_ANG = (2 * Math.PI) / 3   // 120° — 7 o'clock (min position)
  const SWEEP   = (5 * Math.PI) / 3   // 300° total arc

  const canvas = document.createElement('canvas')
  canvas.width  = SIZE
  canvas.height = SIZE
  canvas.style.cssText = 'cursor:ns-resize; image-rendering:pixelated; display:block;'

  let value = Math.max(0, Math.min(1, initial))

  function draw() {
    const ctx = canvas.getContext('2d')
    const cx = SIZE / 2
    const cy = SIZE / 2
    const R  = SIZE / 2 - 2

    ctx.clearRect(0, 0, SIZE, SIZE)

    // Body
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fillStyle = '#0d1428'
    ctx.fill()
    ctx.strokeStyle = 'rgba(80,110,200,0.45)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Track arc (full 300° range)
    ctx.beginPath()
    ctx.arc(cx, cy, R - 3, MIN_ANG, MIN_ANG + SWEEP)
    ctx.strokeStyle = 'rgba(100,140,230,0.18)'
    ctx.lineWidth = 2.5
    ctx.stroke()

    // Value arc
    const valAng = MIN_ANG + value * SWEEP
    if (value > 0.001) {
      ctx.beginPath()
      ctx.arc(cx, cy, R - 3, MIN_ANG, valAng)
      ctx.strokeStyle = '#66bb6a'
      ctx.lineWidth = 2.5
      ctx.stroke()
    }

    // Indicator tick at current position
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(valAng) * (R - 8), cy + Math.sin(valAng) * (R - 8))
    ctx.lineTo(cx + Math.cos(valAng) * (R - 2), cy + Math.sin(valAng) * (R - 2))
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  draw()

  // ── Drag interaction (vertical: drag up = louder) ──
  let dragStartY = null
  let dragStartVal = 0

  const onDown = (y) => { dragStartY = y; dragStartVal = value }
  const onMove = (y) => {
    if (dragStartY == null) return
    value = Math.max(0, Math.min(1, dragStartVal + (dragStartY - y) / 80))
    draw()
    onChange(value)
  }
  const onUp = () => { dragStartY = null }

  canvas.addEventListener('mousedown',  e => { onDown(e.clientY); e.preventDefault() })
  canvas.addEventListener('touchstart', e => { onDown(e.touches[0].clientY); e.preventDefault() }, { passive: false })
  window.addEventListener('mousemove',  e => onMove(e.clientY))
  window.addEventListener('touchmove',  e => { onMove(e.touches[0].clientY); e.preventDefault() }, { passive: false })
  window.addEventListener('mouseup',  onUp)
  window.addEventListener('touchend', onUp)

  // Scroll wheel
  canvas.addEventListener('wheel', e => {
    value = Math.max(0, Math.min(1, value - e.deltaY / 500))
    draw()
    onChange(value)
    e.preventDefault()
  }, { passive: false })

  return canvas
}

// ── Panel build ───────────────────────────────────────────────────────────────

export function initStats() {
  const panel = document.createElement('div')
  panel.id = 'stats-panel'

  // Quick links
  const badges = QUICK_LINKS.map(l => `
    <a class="ql-badge"
       href="${l.href}"
       target="_blank"
       rel="noopener"
       style="color:${l.color}; box-shadow: 0 0 8px ${l.glow}, inset 0 0 8px ${l.glow}; border-color:${l.color}55;">
      ${l.icon ?? ''}${l.label}
    </a>`).join('')

  // RSS sections
  const rssBlocks = RSS_FEEDS.map(f => `
    <div class="sp-group">
      <div class="sp-group-label">&#x25B8; ${f.label}</div>
      <ul class="rss-list" id="rss-${f.id}">
        <li class="rss-item rss-err">loading…</li>
      </ul>
    </div>`).join('')

  panel.innerHTML = `
    <div class="sp-top">
      <div class="sp-title">${config.display.siteName ?? 'HOMESTEAD'}</div>
      <div class="sp-group ql-group">
        <div class="sp-group-label">&#x25B8; QUICK LINKS</div>
        <div class="ql-row">${badges}</div>
      </div>
    </div>

    <div class="rss-scroll-area">${rssBlocks}</div>

    <div class="sp-bottom">
      <div class="sp-divider"></div>
      <div class="sp-row">
        <span class="sp-room">OUTSIDE</span>
        <span class="sp-val" id="sp-outside">---°F</span>
      </div>
      <div class="sp-weather" id="sp-weather-label">—</div>
    </div>
  `

  document.body.appendChild(panel)

  // Floating volume knob — lower right corner
  const volWidget = document.createElement('div')
  volWidget.id = 'vol-widget'
  const pct = document.createElement('span')
  pct.id = 'vol-pct'
  pct.className = 'vol-pct'
  pct.textContent = `${Math.round(getVolume() * 100)}%`
  const knob = createKnob(getVolume(), v => {
    setVolume(v)
    pct.textContent = `${Math.round(v * 100)}%`
  })
  volWidget.appendChild(knob)
  volWidget.appendChild(pct)
  document.body.appendChild(volWidget)

  startRSSPolling()
}

// ── Live update helpers ───────────────────────────────────────────────────────

function tempColor(f) {
  if (f == null) return '#555566'
  if (f < 55)   return '#88ddff'
  if (f < 65)   return '#aaddee'
  if (f < 72)   return '#ffffff'
  if (f < 78)   return '#ffdd66'
  return '#ff7733'
}

function fmtTemp(f) {
  return f == null ? '---°F' : `${f.toFixed(1)}°F`
}

export function updateStat(id, tempF) {
  const el = document.getElementById(`sp-${id}`)
  if (!el) return
  el.textContent = fmtTemp(tempF)
  el.style.color = tempColor(tempF)
}

export function updateOutsideStats(tempC, weatherLabel) {
  const tempF = tempC != null ? tempC * 9 / 5 + 32 : null
  updateStat('outside', tempF)
  const lbl = document.getElementById('sp-weather-label')
  if (lbl) lbl.textContent = weatherLabel ?? '—'
}

// ── Home Assistant polling (activate via config.homeAssistant) ────────────────

export const ROOM_GROUPS = [
  {
    label: 'DOWNSTAIRS',
    rooms: [
      { id: 'main_entry', label: 'MAIN ENTRY', entity: 'sensor.main_entry_temperature'    },
      { id: 'kitchen',    label: 'KITCHEN',    entity: 'sensor.kitchen_temperature'       },
      { id: 'main_bath',  label: 'MAIN BATH',  entity: 'sensor.main_bathroom_temperature' },
    ],
  },
  {
    label: 'UPSTAIRS',
    rooms: [
      { id: 'office',    label: 'OFFICE',    entity: 'sensor.office_temperature'        },
      { id: 'guest_bed', label: 'GUEST BED', entity: 'sensor.guest_bedroom_temperature' },
    ],
  },
  {
    label: 'UNCONDITIONED',
    rooms: [
      { id: 'basement',   label: 'BASEMENT',   entity: 'sensor.basement_temperature'     },
      { id: 'laundry',    label: 'LAUNDRY',    entity: 'sensor.laundry_room_temperature' },
      { id: 'great_room', label: 'GREAT ROOM', entity: 'sensor.great_room_temperature'   },
    ],
  },
]

export async function pollHA(haUrl, haToken) {
  const headers  = { Authorization: `Bearer ${haToken}` }
  const allRooms = ROOM_GROUPS.flatMap(g => g.rooms)
  await Promise.allSettled(allRooms.map(async room => {
    try {
      const res  = await fetch(`${haUrl}/api/states/${room.entity}`, { headers })
      const data = await res.json()
      const val  = parseFloat(data.state)
      if (!isNaN(val)) updateStat(room.id, val)   // adjust °C→°F here if needed
    } catch { /* stay at last value */ }
  }))
}

export function startHAPolling(haUrl, haToken, intervalMs = 60_000) {
  pollHA(haUrl, haToken)
  setInterval(() => pollHA(haUrl, haToken), intervalMs)
}
