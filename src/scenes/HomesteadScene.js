import Phaser from 'phaser'
import SunCalc from 'suncalc'
import { resolveLocation, startWeatherPolling } from '../weather-client.js'

const W = 320
const H = 180
const GROUND_Y = 145   // where ground meets house/trees

// ─── Colour palette ──────────────────────────────────────────────────────────

const C = {
  // House
  walls:         0xf5e6c8,
  wallsShadow:   0xd9c5a0,
  roof:          0x8b4513,
  roofShadow:    0x5c2e0a,
  chimney:       0x795548,
  door:          0x4e2800,
  doorFrame:     0x7a4a1e,
  windowDay:     0xadd8e6,
  windowNight:   0xfffde7,
  windowGlow:    0xffd54f,

  // Nature
  ground:        0x5c8a30,
  groundDark:    0x3d6122,
  groundLight:   0x7ab648,
  treeTrunk:     0x5d4037,
  treeLeaves:    0x2e7d32,
  treeLeavesMid: 0x388e3c,
  treeLeavesTop: 0x43a047,

  // Sky key frames  [zenith, horizon]
  skyNight:      [0x060d2b, 0x0d1b45],
  skyTwilight:   [0x1a0e3e, 0xe07030],
  skySunrise:    [0x2d4a8a, 0xff8c42],
  skyDay:        [0x1565c0, 0x90caf9],
  skySunset:     [0x2d4a8a, 0xff6b35],
  skyOvercast:   [0x546e7a, 0x78909c],
  skyStorm:      [0x1a2030, 0x2d3a4a],
  skyScorch:     [0x0d47a1, 0xffc107],

  // Effects
  sun:           0xffeb3b,
  sunCore:       0xffffff,
  moon:          0xfff9c4,
  moonGlow:      0xe8eaf6,
  rainDrop:      0x90caf9,
  snowFlake:     0xffffff,
  fog:           0xcfd8dc,
  lightning:     0xffffff,
  smoke:         0xbdbdbd,
}

// ─── Sky colour helpers ───────────────────────────────────────────────────────

function lerpColor(a, b, t) {
  t = Math.max(0, Math.min(1, t))
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  return (Math.round(ar + (br - ar) * t) << 16) |
         (Math.round(ag + (bg - ag) * t) << 8)  |
          Math.round(ab + (bb - ab) * t)
}

/**
 * Returns { zenith, horizon } sky colours based on sun elevation (-π/2..π/2)
 * and current weather state.
 */
function targetSkyColors(elevRad, weatherState) {
  const elev = elevRad * (180 / Math.PI)  // degrees

  // Determine base sky from sun elevation
  let zenith, horizon
  if (elev < -12) {
    ;[zenith, horizon] = C.skyNight
  } else if (elev < -6) {
    const t = (elev + 12) / 6
    zenith  = lerpColor(C.skyNight[0],    C.skyTwilight[0], t)
    horizon = lerpColor(C.skyNight[1],    C.skyTwilight[1], t)
  } else if (elev < 0) {
    const t = (elev + 6) / 6
    zenith  = lerpColor(C.skyTwilight[0], C.skySunrise[0], t)
    horizon = lerpColor(C.skyTwilight[1], C.skySunrise[1], t)
  } else if (elev < 8) {
    const t = elev / 8
    zenith  = lerpColor(C.skySunrise[0],  C.skyDay[0], t)
    horizon = lerpColor(C.skySunrise[1],  C.skyDay[1], t)
  } else {
    zenith  = C.skyDay[0]
    horizon = C.skyDay[1]
  }

  // Blend in weather overrides
  switch (weatherState) {
    case 'overcast':
    case 'fog':
    case 'drizzle':
      zenith  = lerpColor(zenith,  C.skyOvercast[0], 0.7)
      horizon = lerpColor(horizon, C.skyOvercast[1], 0.7)
      break
    case 'rain':
    case 'heavy-rain':
    case 'snow':
    case 'heavy-snow':
      zenith  = lerpColor(zenith,  C.skyStorm[0], 0.6)
      horizon = lerpColor(horizon, C.skyStorm[1], 0.6)
      break
    case 'thunderstorm':
      zenith  = lerpColor(zenith,  C.skyStorm[0], 0.9)
      horizon = lerpColor(horizon, C.skyStorm[1], 0.9)
      break
    case 'scorching':
      zenith  = lerpColor(zenith,  C.skyScorch[0], 0.4)
      horizon = lerpColor(horizon, C.skyScorch[1], 0.5)
      break
  }

  return { zenith, horizon }
}

// ─── Scene ───────────────────────────────────────────────────────────────────

export default class HomesteadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HomesteadScene' })
    this.weather = null
    this.lat = 51.5074
    this.lon = -0.1278
    this.skyZenith  = C.skyDay[0]
    this.skyHorizon = C.skyDay[1]
    this.clouds = []
    this.stars  = []
    this.snowAccum = 0   // 0..1
    this.lightningTimer = 0
  }

  // ── called by main.js once weather + location are known ──────────────────
  setLocation(lat, lon) {
    this.lat = lat
    this.lon = lon
  }

  applyWeather(weatherObj) {
    this.weather = weatherObj
    this._updateParticles()
    this._updateFog()
    this._updateHud()
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  create() {
    this._buildTextures()

    // Layers (drawn back-to-front)
    this.skyGfx      = this.add.graphics()
    this.starGfx     = this.add.graphics()
    this.celestialGfx = this.add.graphics()
    this.cloudGfx    = this.add.graphics()
    this.bgGfx       = this.add.graphics()   // distant hills
    this.houseGfx    = this.add.graphics()
    this.fgGfx       = this.add.graphics()   // ground + near trees
    this.snowRoofGfx = this.add.graphics()

    // Weather overlays
    this.fogRect = this.add.rectangle(W / 2, H / 2, W, H, C.fog, 0)
    this.fogRect.setDepth(50)
    this.lightningRect = this.add.rectangle(W / 2, H / 2, W, H, C.lightning, 0)
    this.lightningRect.setDepth(60)

    // Heat shimmer (scorching) — pulsing warm tint
    this.heatRect = this.add.rectangle(W / 2, H / 2, W, H, 0xff8f00, 0)
    this.heatRect.setDepth(55)

    // Moonlit ambient — subtle blue-white lift so the house reads at night
    this.nightAmbient = this.add.rectangle(W / 2, H / 2, W, H, 0x8ab4e8, 0)
    this.nightAmbient.setDepth(1)   // just above sky, behind everything else

    this._buildStars()
    this._buildClouds()
    this._buildBackground()
    this._buildHouse()
    this._buildForeground()
    this._buildParticleEmitters()
    this._initWeather()
  }

  async _initWeather() {
    try {
      const { lat, lon } = await resolveLocation()
      this.setLocation(lat, lon)
      startWeatherPolling(lat, lon, weather => this.applyWeather(weather))
    } catch (e) {
      console.error('Weather init failed:', e)
      document.getElementById('hud').textContent = 'Weather unavailable'
    }
  }

  update(time, delta) {
    const dt = delta / 1000  // seconds

    this._updateSky(dt)
    this._updateCelestial()
    this._updateClouds(dt)
    this._updateLightning(dt)
    this._updateHeatShimmer(time)
    this._updateWindowLighting()
    this._updateSnowRoof(dt)
  }

  // ── textures ──────────────────────────────────────────────────────────────

  _buildTextures() {
    // 1×3 rain streak
    const rg = this.make.graphics({ add: false })
    rg.fillStyle(C.rainDrop, 0.85)
    rg.fillRect(0, 0, 1, 3)
    rg.generateTexture('rain', 1, 3)
    rg.destroy()

    // 2×2 snowflake
    const sg = this.make.graphics({ add: false })
    sg.fillStyle(C.snowFlake, 0.9)
    sg.fillRect(0, 0, 2, 2)
    sg.generateTexture('snow', 2, 2)
    sg.destroy()

    // 2×2 smoke puff
    const smg = this.make.graphics({ add: false })
    smg.fillStyle(C.smoke, 0.5)
    smg.fillRect(0, 0, 2, 2)
    smg.generateTexture('smoke', 2, 2)
    smg.destroy()
  }

  // ── stars ─────────────────────────────────────────────────────────────────

  _buildStars() {
    const rng = new Phaser.Math.RandomDataGenerator(['homestead-stars'])
    for (let i = 0; i < 60; i++) {
      this.stars.push({
        x:    rng.between(0, W),
        y:    rng.between(2, 90),
        size: rng.pick([1, 1, 1, 2]),
        phase: rng.frac() * Math.PI * 2,
      })
    }
  }

  // ── clouds ────────────────────────────────────────────────────────────────

  _buildClouds() {
    const specs = [
      { x: 30,  y: 28, w: 42, h: 10, speed: 2.5, alpha: 0.88 },
      { x: 120, y: 20, w: 55, h: 12, speed: 1.8, alpha: 0.92 },
      { x: 220, y: 32, w: 35, h: 9,  speed: 3.0, alpha: 0.80 },
      { x: 280, y: 18, w: 48, h: 11, speed: 2.1, alpha: 0.85 },
      { x: 70,  y: 42, w: 30, h: 8,  speed: 2.8, alpha: 0.75 },
    ]
    this.clouds = specs
  }

  _drawCloud(gfx, x, y, w, h, alpha, col = 0xffffff) {
    gfx.fillStyle(col, alpha)
    // chunky pixel-art cloud: three overlapping rectangles
    const b = Math.floor(h * 0.4)
    gfx.fillRect(x,              y + b,          w,          h - b)   // base
    gfx.fillRect(x + 2,          y + Math.round(b * 0.5), w - 4, b + 2)  // mid bump
    gfx.fillRect(x + Math.round(w * 0.3), y,    Math.round(w * 0.4), b + 2) // top bump
  }

  // ── background hills ──────────────────────────────────────────────────────

  _buildBackground() {
    const g = this.bgGfx
    // Distant hills
    g.fillStyle(0x3d7a28, 1)
    g.fillRect(0, 115, 60, 30)
    g.fillRect(0, 110, 35, 35)
    g.fillStyle(0x4a8f30, 1)
    g.fillRect(265, 118, 55, 27)
    g.fillRect(285, 112, 35, 33)
    // Pixel art: manual stepped edges for hills
    g.fillStyle(0x3d7a28, 1)
    for (let i = 0; i < 20; i++) {
      g.fillRect(i * 3, 115 - Math.round(Math.sin(i * 0.4) * 5), 3, 1)
    }
  }

  // ── house ─────────────────────────────────────────────────────────────────

  _buildHouse() {
    const g = this.houseGfx
    this._drawHouseBody(g)
  }

  _drawHouseBody(g) {
    g.clear()

    const hx = 110, hy = 80, hw = 100, hh = 65   // body rect
    const roofPeakX = hx + hw / 2
    const roofPeakY = 52
    const roofBaseY = hy

    // ── Chimney (behind roof) ─────────────────────────────────────────────
    g.fillStyle(C.chimney, 1)
    g.fillRect(roofPeakX + 12, roofPeakY - 16, 10, 22)
    g.fillStyle(0x5d4037, 1)
    g.fillRect(roofPeakX + 11, roofPeakY - 17, 12, 3)   // chimney cap

    // ── Roof ──────────────────────────────────────────────────────────────
    // Triangle as stacked horizontal strips
    const roofH = roofBaseY - roofPeakY
    for (let row = 0; row < roofH; row++) {
      const t = row / roofH
      const halfW = Math.round((hw / 2 + 8) * t)
      const col = row < 3 ? C.roofShadow : (row % 2 === 0 ? C.roof : C.roofShadow)
      g.fillStyle(col, 1)
      g.fillRect(roofPeakX - halfW, roofPeakY + row, halfW * 2, 1)
    }
    // Roof edge overhang
    g.fillStyle(C.roofShadow, 1)
    g.fillRect(hx - 6, roofBaseY, hw + 12, 3)

    // ── Walls ─────────────────────────────────────────────────────────────
    g.fillStyle(C.walls, 1)
    g.fillRect(hx, hy, hw, hh)
    // Shadow on right side
    g.fillStyle(C.wallsShadow, 1)
    g.fillRect(hx + hw - 8, hy, 8, hh)

    // ── Door ──────────────────────────────────────────────────────────────
    g.fillStyle(C.doorFrame, 1)
    g.fillRect(hx + 38, hy + 27, 26, 38)
    g.fillStyle(C.door, 1)
    g.fillRect(hx + 40, hy + 29, 22, 36)
    // Door knob
    g.fillStyle(C.doorFrame, 1)
    g.fillRect(hx + 58, hy + 46, 2, 2)

    // ── Windows ───────────────────────────────────────────────────────────
    this._drawWindow(g, hx + 8,  hy + 14, 22, 18)   // left
    this._drawWindow(g, hx + 70, hy + 14, 22, 18)   // right
  }

  _drawWindow(g, x, y, w, h) {
    const isNight = this._isNight()
    const winCol  = isNight ? C.windowNight : C.windowDay

    // Frame
    g.fillStyle(C.doorFrame, 1)
    g.fillRect(x - 2, y - 2, w + 4, h + 4)
    // Glass
    g.fillStyle(winCol, 1)
    g.fillRect(x, y, w, h)
    // Divider cross
    g.fillStyle(C.doorFrame, 1)
    g.fillRect(x + Math.floor(w / 2) - 1, y, 2, h)
    g.fillRect(x, y + Math.floor(h / 2) - 1, w, 2)

    // Night glow — draw a soft halo using concentric rects at low alpha
    if (isNight) {
      g.fillStyle(C.windowGlow, 0.25)
      g.fillRect(x - 4, y - 4, w + 8, h + 8)
      g.fillStyle(C.windowGlow, 0.12)
      g.fillRect(x - 7, y - 7, w + 14, h + 14)
    }
  }

  // ── foreground ────────────────────────────────────────────────────────────

  _buildForeground() {
    const g = this.fgGfx

    // Ground strips
    g.fillStyle(C.groundDark, 1)
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y)
    g.fillStyle(C.ground, 1)
    g.fillRect(0, GROUND_Y, W, 5)
    g.fillStyle(C.groundLight, 1)
    g.fillRect(0, GROUND_Y, W, 2)

    // Path
    g.fillStyle(0xc8a878, 1)
    g.fillRect(146, GROUND_Y, 28, 35)
    g.fillStyle(0xb89860, 1)
    g.fillRect(149, GROUND_Y + 2, 22, 33)

    // Left tree (pine)
    this._drawTree(g, 68, GROUND_Y - 5, 18, 42)
    // Right tree (pine)
    this._drawTree(g, 250, GROUND_Y - 5, 16, 38)
    // Small shrub left of door
    this._drawShrub(g, 133, GROUND_Y - 2)
    this._drawShrub(g, 180, GROUND_Y - 2)
  }

  _drawTree(g, baseX, baseY, w, h) {
    // Pixel-art pine: stacked triangles
    const trunk = 4
    g.fillStyle(C.treeTrunk, 1)
    g.fillRect(baseX - 2, baseY - trunk, 4, trunk + 3)

    const layers = 3
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1)
      const layerH = Math.round(h / layers)
      const layerY = baseY - trunk - (i + 1) * layerH * 0.8
      const halfW  = Math.round((w / 2) * (1 - t * 0.3))
      const col = i === 0 ? C.treeLeaves : (i === 1 ? C.treeLeavesMid : C.treeLeavesTop)
      // Each layer: narrow at top, wide at bottom (proper pine shape)
      for (let row = 0; row < layerH; row++) {
        const rw = Math.round(halfW * (row + 1) / layerH) * 2 + 2
        g.fillStyle(col, 1)
        g.fillRect(baseX - Math.floor(rw / 2), layerY + row, rw, 1)
      }
    }
  }

  _drawShrub(g, x, y) {
    g.fillStyle(C.treeLeaves, 1)
    g.fillRect(x - 5, y - 6, 10, 8)
    g.fillRect(x - 3, y - 9, 6, 5)
    g.fillStyle(C.treeLeavesMid, 1)
    g.fillRect(x - 4, y - 7, 8, 3)
  }

  // ── snow on roof ──────────────────────────────────────────────────────────

  _buildSnowRoof() {
    // drawn in update when accumulation changes
  }

  _drawSnowRoof(accum) {
    const g = this.snowRoofGfx
    g.clear()
    if (accum <= 0) return
    const hx = 110, hy = 80, hw = 100
    const roofPeakX = hx + hw / 2
    const roofPeakY = 52
    const roofBaseY = hy
    const roofH = roofBaseY - roofPeakY
    const maxDepth = 4

    for (let row = 0; row < roofH; row++) {
      const t = row / roofH
      const halfW = Math.round((hw / 2 + 8) * t)
      const depth = Math.round(maxDepth * accum * t)
      if (depth <= 0) continue
      g.fillStyle(0xffffff, 0.9)
      g.fillRect(roofPeakX - halfW, roofPeakY + row, halfW * 2, depth)
    }
    // chimney cap snow
    g.fillStyle(0xffffff, 0.9)
    g.fillRect(roofPeakX + 10, roofPeakY - 17, 14, Math.ceil(maxDepth * accum))
  }

  // ── particle emitters ─────────────────────────────────────────────────────

  _buildParticleEmitters() {
    // Rain
    this.rainEmitter = this.add.particles(0, -5, 'rain', {
      x: { min: -10, max: W + 10 },
      angle: { min: 82, max: 88 },
      speed: { min: 180, max: 240 },
      lifespan: 900,
      quantity: 0,
      frequency: 20,
    })
    this.rainEmitter.setDepth(40)

    // Snow
    this.snowEmitter = this.add.particles(0, -4, 'snow', {
      x: { min: -10, max: W + 10 },
      angle: { min: 75, max: 100 },
      speed: { min: 25, max: 55 },
      lifespan: 4000,
      quantity: 0,
      frequency: 60,
    })
    this.snowEmitter.setDepth(41)

    // Chimney smoke
    this.smokeEmitter = this.add.particles(
      110 + 50 + 12 + 5, 52 - 14, 'smoke', {
        x: { min: -1, max: 1 },
        angle: { min: 265, max: 275 },
        speed: { min: 4, max: 10 },
        alpha: { start: 0.5, end: 0 },
        scale: { start: 1, end: 3 },
        lifespan: 2500,
        quantity: 1,
        frequency: 800,
      }
    )
    this.smokeEmitter.setDepth(20)
  }

  _updateParticles() {
    if (!this.weather) return
    const { rainIntensity, snowIntensity } = this.weather

    this.rainEmitter.setQuantity(Math.round(rainIntensity * 6))
    this.snowEmitter.setQuantity(Math.round(snowIntensity * 3))
  }

  // ── sky update ────────────────────────────────────────────────────────────

  _updateSky(dt) {
    const sun = SunCalc.getPosition(new Date(), this.lat, this.lon)
    const weatherState = this.weather?.state ?? 'clear'
    const { zenith, horizon } = targetSkyColors(sun.altitude, weatherState)

    // Smooth lerp toward target (speed based on elapsed seconds)
    const speed = dt * 0.4
    this.skyZenith  = lerpColor(this.skyZenith,  zenith,  speed)
    this.skyHorizon = lerpColor(this.skyHorizon, horizon, speed)

    // Draw sky gradient
    this.skyGfx.clear()
    this.skyGfx.fillGradientStyle(
      this.skyZenith, this.skyZenith,
      this.skyHorizon, this.skyHorizon,
      1
    )
    this.skyGfx.fillRect(0, 0, W, H)

    // Night ambient lift — fades in as sun goes below horizon
    // max 0.10 alpha so it tints without washing out the sky gradient
    const elev = sun.altitude * (180 / Math.PI)
    const nightAlpha = Math.max(0, Math.min(0.10, (-elev - 2) / 20))
    this.nightAmbient.setAlpha(nightAlpha)

    // Stars (visible when dark)
    this._drawStars(sun.altitude)

    // Clouds
    this._drawClouds(sun.altitude, weatherState)
  }

  // ── stars ─────────────────────────────────────────────────────────────────

  _drawStars(elevRad) {
    const elev = elevRad * (180 / Math.PI)
    // Visible when sun is below -6° (civil twilight end), fade in from -6 to -14
    const starAlpha = Math.max(0, Math.min(1, (-elev - 6) / 8))
    const g = this.starGfx
    g.clear()
    if (starAlpha <= 0) return

    const t = this.time.now / 3000
    for (const s of this.stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(t + s.phase)
      g.fillStyle(0xffffff, starAlpha * (0.5 + twinkle * 0.5))
      g.fillRect(s.x, s.y, s.size, s.size)
    }
  }

  // ── celestial (sun + moon) ────────────────────────────────────────────────

  _updateCelestial() {
    const now  = new Date()
    const sun  = SunCalc.getPosition(now, this.lat, this.lon)
    const moon = SunCalc.getMoonPosition(now, this.lat, this.lon)
    const g = this.celestialGfx
    g.clear()

    // Map altitude + azimuth to screen position along an arc
    // azimuth: 0=south, -π=north, ±π/2 = east/west
    const sunPos  = this._celestialToScreen(sun.altitude,  sun.azimuth)
    const moonPos = this._celestialToScreen(moon.altitude, moon.azimuth)

    // Moon (draw first so sun can overlap)
    if (moon.altitude > -0.1) {
      g.fillStyle(C.moonGlow, 0.25)
      g.fillCircle(moonPos.x, moonPos.y, 8)
      g.fillStyle(C.moon, 0.9)
      g.fillCircle(moonPos.x, moonPos.y, 5)
    }

    // Sun
    const sunAlpha = Math.min(1, Math.max(0, (sun.altitude * (180 / Math.PI) + 2) / 8))
    if (sunAlpha > 0) {
      const isScorch = this.weather?.isScorching
      const sunR = isScorch ? 10 : 7

      // Glow
      g.fillStyle(isScorch ? 0xff8f00 : 0xfff9c4, 0.2 * sunAlpha)
      g.fillCircle(sunPos.x, sunPos.y, sunR + 7)
      g.fillStyle(isScorch ? 0xffcc00 : C.sun, 0.5 * sunAlpha)
      g.fillCircle(sunPos.x, sunPos.y, sunR + 3)
      // Core
      g.fillStyle(C.sunCore, sunAlpha)
      g.fillCircle(sunPos.x, sunPos.y, sunR - 2)
      g.fillStyle(isScorch ? 0xff6f00 : C.sun, sunAlpha)
      g.fillCircle(sunPos.x, sunPos.y, sunR)
    }
  }

  /**
   * Maps sun/moon altitude (-π/2..π/2) + azimuth (radians) to pixel coords.
   * Azimuth 0 = south = screen center. We simplify to a horizontal arc.
   */
  _celestialToScreen(altitude, azimuth) {
    // Normalise azimuth: south=0 → screen center, wrap east/west
    const az = ((azimuth + Math.PI) % (Math.PI * 2)) / (Math.PI * 2)  // 0..1
    const x = Math.round(az * W * 1.4 - W * 0.2)   // allow going off-screen
    // altitude 0° → y = GROUND_Y-2, altitude 90° → y = 10
    const y = Math.round(Phaser.Math.Linear(GROUND_Y - 2, 10, Math.max(0, altitude) / (Math.PI / 2)))
    return { x, y }
  }

  // ── clouds ────────────────────────────────────────────────────────────────

  _updateClouds(dt) {
    for (const c of this.clouds) {
      c.x += c.speed * dt
      if (c.x > W + c.w + 10) c.x = -(c.w + 10)
    }
  }

  _drawClouds(elevRad, weatherState) {
    const g = this.cloudGfx
    g.clear()
    const elev = elevRad * (180 / Math.PI)

    const cloudCover = this.weather?.cloudCover ?? 0
    if (cloudCover <= 0) return

    // Cloud colour shifts with weather / time
    let cloudCol = 0xffffff
    if (['thunderstorm', 'heavy-rain', 'heavy-snow'].includes(weatherState)) cloudCol = 0x607d8b
    else if (['rain', 'snow', 'overcast'].includes(weatherState)) cloudCol = 0x90a4ae
    else if (elev < 0) cloudCol = 0xff9870   // sunset-tinted clouds
    else if (elev < 5) cloudCol = 0xffd0b0

    const visibleCount = Math.ceil(this.clouds.length * cloudCover)
    for (let i = 0; i < visibleCount; i++) {
      const c = this.clouds[i]
      this._drawCloud(g, c.x, c.y, c.w, c.h, c.alpha, cloudCol)
    }
  }

  // ── fog ───────────────────────────────────────────────────────────────────

  _updateFog() {
    const state = this.weather?.state ?? 'clear'
    const target = state === 'fog' ? 0.55 : 0
    this.tweens.add({
      targets: this.fogRect,
      alpha: target,
      duration: 3000,
      ease: 'Sine.easeInOut',
    })
  }

  // ── heat shimmer ──────────────────────────────────────────────────────────

  _updateHeatShimmer(time) {
    const isScorch = this.weather?.isScorching
    if (isScorch) {
      const pulse = 0.04 + 0.03 * Math.sin(time / 600)
      this.heatRect.setAlpha(pulse)
    } else {
      this.heatRect.setAlpha(0)
    }
  }

  // ── lightning ─────────────────────────────────────────────────────────────

  _updateLightning(dt) {
    if (this.weather?.state !== 'thunderstorm') {
      this.lightningRect.setAlpha(0)
      return
    }
    this.lightningTimer -= dt
    if (this.lightningTimer <= 0) {
      // Flash
      this.lightningTimer = Phaser.Math.Between(3, 12)
      this.tweens.add({
        targets: this.lightningRect,
        alpha: [0, 0.9, 0.2, 0.8, 0],
        duration: 300,
        ease: 'Linear',
      })
    }
  }

  // ── window lighting ───────────────────────────────────────────────────────

  _updateWindowLighting() {
    // Redraw house every ~0.5s to update window colour (avoids per-frame redraw)
    if (!this._lastWinDraw || this.time.now - this._lastWinDraw > 500) {
      this._lastWinDraw = this.time.now
      this._drawHouseBody(this.houseGfx)
    }
  }

  _isNight() {
    const sun = SunCalc.getPosition(new Date(), this.lat, this.lon)
    return sun.altitude < -0.05
  }

  // ── snow roof accumulation ────────────────────────────────────────────────

  _updateSnowRoof(dt) {
    const snow = this.weather?.snowIntensity ?? 0
    const target = snow > 0 ? Math.min(1, snow + 0.3) : 0
    const speed = dt * (target > this.snowAccum ? 0.05 : 0.01)
    this.snowAccum = Phaser.Math.Linear(this.snowAccum, target, speed)
    this._drawSnowRoof(this.snowAccum)
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  _updateHud() {
    const el = document.getElementById('hud')
    if (!el || !this.weather) return
    const { tempC, label } = this.weather
    const name = window.__homesteadConfig?.location?.name ?? 'My Homestead'
    el.innerHTML = `${name} &nbsp;·&nbsp; ${label} &nbsp;·&nbsp; ${Math.round(tempC)}°C`
  }
}
