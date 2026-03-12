import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import SunCalc from 'suncalc'
import { resolveLocation, startWeatherPolling } from './weather-client.js'
import { config } from './config.js'

const TAU = Math.PI * 2

// ─── Colour helpers ───────────────────────────────────────────────────────────

function hex(n) { return new THREE.Color(n) }

function lerpColor(a, b, t) {
  return new THREE.Color().lerpColors(a, b, Math.max(0, Math.min(1, t)))
}

// ─── Sky colour system ────────────────────────────────────────────────────────

const SKY = {
  nightZenith:     hex(0x060d2b), nightHorizon:    hex(0x0d1b45),
  twilightZenith:  hex(0x1a0e3e), twilightHorizon: hex(0xe07030),
  sunriseZenith:   hex(0x2d4a8a), sunriseHorizon:  hex(0xff8c42),
  dayZenith:       hex(0x1565c0), dayHorizon:      hex(0x90caf9),
  overcastZenith:  hex(0x546e7a), overcastHorizon: hex(0x78909c),
  stormZenith:     hex(0x1a2030), stormHorizon:    hex(0x2d3a4a),
  scorchZenith:    hex(0x0d47a1), scorchHorizon:   hex(0xffc107),
}

function targetSkyColors(elevRad, weatherState) {
  const e = elevRad * (180 / Math.PI)
  let zenith, horizon

  if (e < -12) {
    zenith = SKY.nightZenith.clone();    horizon = SKY.nightHorizon.clone()
  } else if (e < -6) {
    const t = (e + 12) / 6
    zenith  = lerpColor(SKY.nightZenith,    SKY.twilightZenith,  t)
    horizon = lerpColor(SKY.nightHorizon,   SKY.twilightHorizon, t)
  } else if (e < 0) {
    const t = (e + 6) / 6
    zenith  = lerpColor(SKY.twilightZenith, SKY.sunriseZenith,   t)
    horizon = lerpColor(SKY.twilightHorizon,SKY.sunriseHorizon,  t)
  } else if (e < 8) {
    const t = e / 8
    zenith  = lerpColor(SKY.sunriseZenith,  SKY.dayZenith,       t)
    horizon = lerpColor(SKY.sunriseHorizon, SKY.dayHorizon,       t)
  } else {
    zenith  = SKY.dayZenith.clone();  horizon = SKY.dayHorizon.clone()
  }

  const blend = (a, b, f) => { zenith.lerp(a, f);  horizon.lerp(b, f) }

  switch (weatherState) {
    case 'overcast': case 'fog': case 'drizzle':
      blend(SKY.overcastZenith, SKY.overcastHorizon, 0.7); break
    case 'rain': case 'heavy-rain': case 'snow': case 'heavy-snow':
      blend(SKY.stormZenith, SKY.stormHorizon, 0.6); break
    case 'thunderstorm':
      blend(SKY.stormZenith, SKY.stormHorizon, 0.9); break
    case 'scorching':
      blend(SKY.scorchZenith, SKY.scorchHorizon, 0.4); break
  }
  return { zenith, horizon }
}

// ─── Sky mesh (fullscreen gradient quad) ─────────────────────────────────────

function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith:  { value: new THREE.Color(SKY.dayZenith) },
      uHorizon: { value: new THREE.Color(SKY.dayHorizon) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: `
      uniform vec3 uZenith; uniform vec3 uHorizon;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(mix(uHorizon, uZenith, vUv.y), 1.0); }
    `,
    depthWrite: false, depthTest: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  mesh.renderOrder = -100
  scene.add(mesh)
  return mat.uniforms
}

// ─── Stars ────────────────────────────────────────────────────────────────────

function buildStars(scene) {
  const N = 120
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    // Random direction on upper hemisphere, far away
    const theta = Math.random() * TAU
    const phi   = Math.random() * Math.PI * 0.5   // upper hemisphere only
    pos[i*3]   = Math.sin(phi) * Math.cos(theta) * 40
    pos[i*3+1] = Math.cos(phi) * 40 + 2
    pos[i*3+2] = Math.sin(phi) * Math.sin(theta) * 40
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, sizeAttenuation: true })
  const stars = new THREE.Points(geo, mat)
  scene.add(stars)
  return { stars, mat }
}

// ─── Sun / Moon ───────────────────────────────────────────────────────────────

function buildCelestials(scene) {
  const sunMat  = new THREE.MeshBasicMaterial({ color: 0xffeb3b })
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xfff9c4 })
  const sunMesh  = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 6), sunMat)
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 6), moonMat)
  sunMesh.renderOrder  = -50
  moonMesh.renderOrder = -50
  scene.add(sunMesh)
  scene.add(moonMesh)
  return { sunMesh, moonMesh, sunMat }
}

function updateCelestials({ sunMesh, moonMesh, sunMat }, lat, lon, weatherState) {
  const now  = new Date()
  const sun  = SunCalc.getPosition(now, lat, lon)
  const moon = SunCalc.getMoonPosition(now, lat, lon)

  function elevAzToPos(alt, az, dist) {
    // Place body on a sphere around origin
    const x = Math.cos(alt) * Math.sin(az)  * dist
    const y = Math.sin(alt)                 * dist
    const z = Math.cos(alt) * Math.cos(az)  * dist
    return new THREE.Vector3(x, y, z)
  }

  sunMesh.position.copy(elevAzToPos(sun.altitude, sun.azimuth, 22))
  moonMesh.position.copy(elevAzToPos(moon.altitude, moon.azimuth, 20))

  const sunVisible = sun.altitude > -0.05
  sunMesh.visible  = sunVisible && weatherState !== 'overcast' && weatherState !== 'thunderstorm'
  moonMesh.visible = moon.altitude > 0

  // Scorching: bigger, more orange sun
  if (weatherState === 'scorching') {
    sunMesh.scale.setScalar(1.4)
    sunMat.color.setHex(0xff9800)
  } else {
    sunMesh.scale.setScalar(1.0)
    sunMat.color.setHex(0xffeb3b)
  }
}

// ─── Clouds ───────────────────────────────────────────────────────────────────

function buildClouds(scene) {
  const cloudData = [
    { x: -4.5, y: 5.5, z: -6, w: 2.5, h: 0.5, d: 1.2, speed: 0.4 },
    { x:  0.5, y: 6.2, z: -8, w: 3.2, h: 0.6, d: 1.5, speed: 0.28 },
    { x:  5.0, y: 5.0, z: -5, w: 2.0, h: 0.4, d: 1.0, speed: 0.5  },
    { x: -2.0, y: 6.8, z:-10, w: 2.8, h: 0.55,d: 1.3, speed: 0.22 },
    { x:  3.5, y: 5.8, z: -7, w: 2.2, h: 0.45,d: 1.1, speed: 0.38 },
  ]
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 })
  const group = new THREE.Group()
  const meshes = cloudData.map(c => {
    const geo  = new THREE.BoxGeometry(c.w, c.h, c.d)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(c.x, c.y, c.z)
    mesh.userData = c
    group.add(mesh)
    return mesh
  })
  scene.add(group)
  return { group, meshes, mat }
}

function updateClouds({ meshes, mat }, dt, weatherState, sunElevRad) {
  const cover = { clear: 0, 'mostly-clear': 0.2, 'partly-cloudy': 0.6, overcast: 1,
    fog: 1, drizzle: 0.9, rain: 1, 'heavy-rain': 1, snow: 1, 'heavy-snow': 1,
    thunderstorm: 1, scorching: 0 }[weatherState] ?? 0

  mat.opacity = 0.7 + cover * 0.2
  const visCount = Math.ceil(meshes.length * cover)

  // Cloud colour by time and weather
  const e = sunElevRad * (180 / Math.PI)
  let col = 0xffffff
  if (['thunderstorm','heavy-rain','heavy-snow'].includes(weatherState)) col = 0x607d8b
  else if (['rain','snow','overcast'].includes(weatherState)) col = 0x90a4ae
  else if (e < 0) col = 0xff9870
  else if (e < 5) col = 0xffd0b0
  mat.color.setHex(col)

  meshes.forEach((mesh, i) => {
    mesh.visible = i < visCount
    const c = mesh.userData
    mesh.position.x += c.speed * dt
    if (mesh.position.x > 14) mesh.position.x = -14
  })
}

// ─── Ground ───────────────────────────────────────────────────────────────────

function buildGround(scene) {
  const geo = new THREE.PlaneGeometry(30, 20)
  const mat = new THREE.MeshLambertMaterial({ color: 0x5c8a30, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0
  scene.add(mesh)

  // Darker far ground strip
  const farGeo = new THREE.PlaneGeometry(30, 6)
  const farMat = new THREE.MeshLambertMaterial({ color: 0x3d6122 })
  const farMesh = new THREE.Mesh(farGeo, farMat)
  farMesh.rotation.x = -Math.PI / 2
  farMesh.position.set(0, 0.005, -8)
  scene.add(farMesh)

  // Path
  const pathGeo = new THREE.PlaneGeometry(0.7, 2.5)
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xc8a878 })
  const pathMesh = new THREE.Mesh(pathGeo, pathMat)
  pathMesh.rotation.x = -Math.PI / 2
  pathMesh.position.set(0, 0.01, 2.0)
  scene.add(pathMesh)

  return { mesh, mat }
}

// ─── Background hills ─────────────────────────────────────────────────────────

function buildHills(scene) {
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x3d7a28 })
  const hills = [
    { x: -6, z: -8, w: 5, h: 1.5, d: 3 },
    { x:  6, z: -8, w: 5, h: 1.2, d: 3 },
    { x: -9, z: -7, w: 4, h: 1.0, d: 2.5 },
    { x:  9, z: -7, w: 4, h: 1.1, d: 2.5 },
  ]
  hills.forEach(h => {
    const geo  = new THREE.BoxGeometry(h.w, h.h, h.d)
    const mesh = new THREE.Mesh(geo, hillMat)
    mesh.position.set(h.x, h.h / 2, h.z)
    scene.add(mesh)
  })
}

// ─── House ────────────────────────────────────────────────────────────────────

function makePitchedRoofGeo(width, peakH, depth) {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, 0)
  shape.lineTo(0, peakH)
  shape.lineTo(width / 2, 0)
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geo.translate(0, 0, -depth / 2)
  return geo
}

function buildHouse(scene) {
  const group = new THREE.Group()

  const wallMat    = new THREE.MeshLambertMaterial({ color: 0xf5e6c8 })
  const roofMat    = new THREE.MeshLambertMaterial({ color: 0x7a3b10 })
  const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x795548 })
  const doorMat    = new THREE.MeshLambertMaterial({ color: 0x4e2800 })
  const frameMat   = new THREE.MeshLambertMaterial({ color: 0x7a4a1e })
  const winMat     = new THREE.MeshLambertMaterial({
    color: 0xadd8e6, emissive: 0x000000, emissiveIntensity: 0,
  })

  // ── Body ──
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2), wallMat)
  body.position.set(0, 1, 0)
  group.add(body)

  // ── Roof ──
  const roofGeo = makePitchedRoofGeo(3.4, 1.1, 2.4)
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.position.set(0, 2, 0)
  group.add(roof)

  // ── Roof underside / overhang shade ──
  const overhang = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.12, 2.5), frameMat)
  overhang.position.set(0, 2.0, 0)
  group.add(overhang)

  // ── Chimney ──
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), chimneyMat)
  chimney.position.set(0.7, 2.9, -0.2)
  group.add(chimney)
  const chimneyTop = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), frameMat)
  chimneyTop.position.set(0.7, 3.36, -0.2)
  group.add(chimneyTop)

  // ── Door ──
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.02, 0.06), frameMat)
  doorFrame.position.set(0, 0.51, 1.04)
  group.add(doorFrame)
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.94, 0.06), doorMat)
  door.position.set(0, 0.47, 1.07)
  group.add(door)

  // ── Windows ──
  const winPositions = [[-1.0, 1.3, 1.04], [1.0, 1.3, 1.04]]
  const winMeshes = winPositions.map(([x, y, z]) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.56, 0.06), frameMat)
    frame.position.set(x, y, z)
    group.add(frame)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.44, 0.06), winMat.clone())
    glass.position.set(x, y, z + 0.03)
    group.add(glass)
    // Dividers
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.04), frameMat)
    hBar.position.set(x, y, z + 0.06)
    group.add(hBar)
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.04), frameMat)
    vBar.position.set(x, y, z + 0.06)
    group.add(vBar)
    return glass
  })

  // ── Window glow point light (interior warmth at night) ──
  const winLight = new THREE.PointLight(0xffcc66, 0, 4)
  winLight.position.set(0, 1.2, 1.2)
  group.add(winLight)

  scene.add(group)
  return { group, winMeshes, winLight }
}

function updateHouseNight({ winMeshes, winLight }, lat, lon) {
  const sun = SunCalc.getPosition(new Date(), lat, lon)
  const isNight = sun.altitude < -0.05
  winMeshes.forEach(m => {
    m.material.emissive?.setHex(isNight ? 0xffc87a : 0x000000)
    m.material.emissiveIntensity = isNight ? 0.7 : 0
    m.material.color.setHex(isNight ? 0xfffde7 : 0xadd8e6)
  })
  if (winLight) winLight.intensity = isNight ? 1.5 : 0
}

// ─── Trees ────────────────────────────────────────────────────────────────────

function buildTree(scene, x, z, h) {
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 })
  const layers   = [
    { color: 0x2e7d32, r: h * 0.38, y: h * 0.28, layerH: h * 0.35 },
    { color: 0x388e3c, r: h * 0.30, y: h * 0.48, layerH: h * 0.30 },
    { color: 0x43a047, r: h * 0.20, y: h * 0.66, layerH: h * 0.25 },
  ]

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, h * 0.2, 5),
    trunkMat
  )
  trunk.position.set(x, h * 0.1, z)
  scene.add(trunk)

  layers.forEach(l => {
    const mat  = new THREE.MeshLambertMaterial({ color: l.color })
    const cone = new THREE.Mesh(new THREE.ConeGeometry(l.r, l.layerH, 6), mat)
    cone.position.set(x, l.y, z)
    scene.add(cone)
  })
}

function buildTrees(scene) {
  buildTree(scene, -3.8, 0.2, 2.8)
  buildTree(scene, -3.2, 0.0, 2.2)
  buildTree(scene,  3.8, 0.0, 2.8)
  buildTree(scene,  3.3, 0.3, 2.0)
  buildTree(scene, -5.5, -1.5, 3.5)
  buildTree(scene,  5.2, -1.5, 3.2)
}

// ─── Lighting ─────────────────────────────────────────────────────────────────

function buildLights(scene) {
  const ambient = new THREE.AmbientLight(0x8090b0, 0.6)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.4)
  sun.position.set(4, 6, 3)
  scene.add(sun)

  return { ambient, sun }
}

function updateLights({ ambient, sun }, lat, lon, weatherState) {
  const pos = SunCalc.getPosition(new Date(), lat, lon)
  const e   = pos.altitude * (180 / Math.PI)

  // Ambient simulates moonlight at night, skylight at day.
  // Keep a generous floor so the house always reads against the sky.
  if (e < -12) {
    ambient.color.setHex(0x4060a8); ambient.intensity = 0.55   // deep moonlit night
  } else if (e < -6) {
    ambient.color.setHex(0x5060a0); ambient.intensity = 0.50
  } else if (e < 0) {
    ambient.color.setHex(0x706890); ambient.intensity = 0.55   // civil twilight
  } else if (e < 8) {
    ambient.color.setHex(0xb07840); ambient.intensity = 0.65   // golden hour
  } else {
    ambient.color.setHex(0x8090b0); ambient.intensity = 0.70   // full day
  }

  // Directional: follows sun, dims at night
  const sunIntensity = Math.max(0, e / 60) * 1.6
  sun.intensity = sunIntensity
  sun.color.setHex(e < 8 ? 0xff8c42 : (weatherState === 'scorching' ? 0xffcc44 : 0xfff5e0))
  // Move directional light to follow sun azimuth roughly
  sun.position.set(
    Math.cos(pos.azimuth) * 8,
    Math.max(1, Math.sin(pos.altitude) * 10),
    Math.sin(pos.azimuth) * 8
  )

  // Overcast / storm: reduce dirLight, desaturate ambient
  if (['overcast','fog','rain','heavy-rain','thunderstorm','drizzle'].includes(weatherState)) {
    sun.intensity      *= 0.2
    ambient.intensity  *= 0.9
    ambient.color.setHex(0x607080)
  }
}

// ─── Rain ─────────────────────────────────────────────────────────────────────

function buildRain(scene) {
  const N   = 600
  const pos = new Float32Array(N * 6)  // 2 verts per drop
  function reset(i) {
    const x = Math.random() * 14 - 7
    const y = 5 + Math.random() * 4
    const z = Math.random() * 10 - 6
    pos[i*6+0] = x;       pos[i*6+1] = y;          pos[i*6+2] = z
    pos[i*6+3] = x + 0.05; pos[i*6+4] = y - 0.25;  pos[i*6+5] = z
  }
  for (let i = 0; i < N; i++) reset(i)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat   = new THREE.LineBasicMaterial({ color: 0x90caf9, transparent: true, opacity: 0.7 })
  const lines = new THREE.LineSegments(geo, mat)
  lines.visible = false
  scene.add(lines)
  return { lines, pos, N, reset }
}

function updateRain(rain, dt, intensity) {
  if (intensity <= 0) { rain.lines.visible = false; return }
  rain.lines.visible = true
  const speed = 9 * intensity
  const { pos, N, reset } = rain
  for (let i = 0; i < N; i++) {
    pos[i*6+1] -= speed * dt
    pos[i*6+4] -= speed * dt
    pos[i*6+0] += 0.3 * dt;  pos[i*6+3] += 0.3 * dt
    if (pos[i*6+4] < 0) reset(i)
  }
  rain.lines.geometry.attributes.position.needsUpdate = true
  rain.lines.material.opacity = 0.4 + intensity * 0.4
}

// ─── Snow ─────────────────────────────────────────────────────────────────────

function buildSnow(scene) {
  const N   = 300
  const pos = new Float32Array(N * 3)
  const off = new Float32Array(N)   // phase offset for horizontal drift
  function reset(i) {
    pos[i*3]   = Math.random() * 14 - 7
    pos[i*3+1] = 4 + Math.random() * 5
    pos[i*3+2] = Math.random() * 10 - 6
    off[i]     = Math.random() * TAU
  }
  for (let i = 0; i < N; i++) reset(i)

  const geo  = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat    = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, sizeAttenuation: true })
  const points = new THREE.Points(geo, mat)
  points.visible = false
  scene.add(points)
  return { points, pos, off, N, reset }
}

function updateSnow(snow, dt, intensity, elapsed) {
  if (intensity <= 0) { snow.points.visible = false; return }
  snow.points.visible = true
  const { pos, off, N, reset } = snow
  for (let i = 0; i < N; i++) {
    pos[i*3+1] -= (0.4 + intensity * 0.3) * dt
    pos[i*3]   += Math.sin(elapsed * 0.5 + off[i]) * 0.3 * dt
    if (pos[i*3+1] < 0) reset(i)
  }
  snow.points.geometry.attributes.position.needsUpdate = true
}

// ─── Fog overlay ──────────────────────────────────────────────────────────────

function buildFog(scene) {
  const fog = new THREE.FogExp2(0xcfd8dc, 0)
  scene.fog = fog
  return fog
}

function updateFog(fog, weatherState) {
  const target = weatherState === 'fog' ? 0.12 : 0
  fog.density += (target - fog.density) * 0.01
}

// ─── Weather flash (lightning) ────────────────────────────────────────────────

let _lightningTimer = 0

function updateLightning(lights, dt, weatherState) {
  if (weatherState !== 'thunderstorm') return
  _lightningTimer -= dt
  if (_lightningTimer <= 0) {
    _lightningTimer = 4 + Math.random() * 10
    // Brief boost to ambient
    lights.ambient.intensity = 3.0
    setTimeout(() => { lights.ambient.intensity = 0.25 }, 80)
    setTimeout(() => { lights.ambient.intensity = 2.0  }, 160)
    setTimeout(() => { lights.ambient.intensity = 0.25 }, 240)
  }
}

// ─── Camera ───────────────────────────────────────────────────────────────────

const DEFAULT_CAM = new THREE.Vector3(0, 2.2, 5.5)
const CAM_TARGET  = new THREE.Vector3(0, 0.5, 0)
const IDLE_TIMEOUT_MS = 9000

function initCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 200)
  camera.position.copy(DEFAULT_CAM)
  camera.lookAt(CAM_TARGET)
  return camera
}

function initControls(camera, canvas) {
  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(CAM_TARGET)
  controls.enableDamping    = true
  controls.dampingFactor    = 0.06
  controls.minDistance      = 3
  controls.maxDistance      = 12
  controls.maxPolarAngle    = Math.PI * 0.42
  controls.minPolarAngle    = Math.PI * 0.08
  controls.maxAzimuthAngle  = Math.PI * 0.55
  controls.minAzimuthAngle  = -Math.PI * 0.55
  return controls
}

function updateCamera(camera, controls, elapsed, dt, interactionState) {
  const { isIdle, returnLerp } = interactionState

  if (isIdle) {
    // Breathing idle drift — very slow sinusoidal wander
    const bx = Math.sin(elapsed * TAU * 0.018) * 0.45
    const by = Math.sin(elapsed * TAU * 0.012) * 0.14
    const bz = Math.sin(elapsed * TAU * 0.022) * 0.12

    camera.position.set(
      DEFAULT_CAM.x + bx,
      DEFAULT_CAM.y + by,
      DEFAULT_CAM.z + bz
    )
    camera.lookAt(CAM_TARGET)
    controls.target.copy(CAM_TARGET)
  } else {
    const timeSince = Date.now() - interactionState.lastInteract
    if (timeSince > IDLE_TIMEOUT_MS) {
      // Drift back to default
      const t = Math.min(1, (timeSince - IDLE_TIMEOUT_MS) / 3000)
      camera.position.lerp(DEFAULT_CAM, t * dt * 1.2)
      controls.target.lerp(CAM_TARGET, t * dt * 1.2)
      if (camera.position.distanceTo(DEFAULT_CAM) < 0.05) {
        interactionState.isIdle = true
      }
    }
    controls.update()
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

function updateHud(weather) {
  const el = document.getElementById('hud')
  if (!el || !weather) return
  const name = window.__homesteadConfig?.location?.name ?? 'My Homestead'
  el.innerHTML = `${name} &nbsp;·&nbsp; ${weather.label} &nbsp;·&nbsp; ${Math.round(weather.tempC)}°C`
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function initScene(canvas, onWeather) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(1)
  renderer.setSize(config.display.width, config.display.height, false)
  renderer.setClearColor(0x060d2b, 1)   // fallback if sky shader glitches
  renderer.shadowMap.enabled = false

  const scene  = new THREE.Scene()
  const camera = initCamera(canvas)

  const sky       = buildSky(scene)
  const starObj   = buildStars(scene)
  const celest    = buildCelestials(scene)
  buildHills(scene)
  const clouds    = buildClouds(scene)
  const ground    = buildGround(scene)
  // House — load real GLB model, fall back to procedural if missing
  let house = { winMeshes: [], winLight: new THREE.PointLight(0xffcc66, 0, 5) }
  house.winLight.position.set(0, 1.2, 1.5)
  scene.add(house.winLight)

  const loader = new GLTFLoader()
  loader.load('./bondstreet.glb', (gltf) => {
    const model = gltf.scene
    model.scale.setScalar(0.3)
    model.position.set(1.5, 0, 0)   // shift right to center the 3-section complex
    scene.add(model)
    // Collect glass meshes for night emissive glow
    model.traverse(child => {
      if (child.isMesh && child.material?.name?.toLowerCase().includes('glass')) {
        child.material = child.material.clone()  // own copy so we can mutate
        house.winMeshes.push(child)
      }
    })
  }, undefined, (err) => {
    console.warn('bondstreet.glb not found, using procedural house:', err)
    house = buildHouse(scene)
  })

  buildTrees(scene)
  const rain      = buildRain(scene)
  const snow      = buildSnow(scene)
  const fog       = buildFog(scene)
  const lights    = buildLights(scene)
  const controls  = initControls(camera, canvas)

  const interactionState = { isIdle: true, lastInteract: 0 }
  controls.addEventListener('start', () => {
    interactionState.isIdle       = false
    interactionState.lastInteract = Date.now()
  })
  controls.addEventListener('change', () => {
    interactionState.lastInteract = Date.now()
  })

  // State
  let lat = config.location.lat  ?? 42.4973
  let lon = config.location.lon  ?? -72.6979
  let weatherState = { state: 'clear', tempC: 12, label: 'Clear', rainIntensity: 0, snowIntensity: 0 }

  // Current sky colours (lerped each frame)
  const curZenith  = new THREE.Color(SKY.nightZenith)
  const curHorizon = new THREE.Color(SKY.nightHorizon)

  const clock = new THREE.Clock()

  function animate() {
    requestAnimationFrame(animate)
    const dt      = clock.getDelta()
    const elapsed = clock.getElapsedTime()

    // Sky
    const sunPos = SunCalc.getPosition(new Date(), lat, lon)
    const { zenith, horizon } = targetSkyColors(sunPos.altitude, weatherState.state)
    curZenith.lerp(zenith,   Math.min(1, dt * 0.3))
    curHorizon.lerp(horizon, Math.min(1, dt * 0.3))
    sky.uZenith.value.copy(curZenith)
    sky.uHorizon.value.copy(curHorizon)

    // Stars (fade with sun elevation)
    const elevDeg = sunPos.altitude * (180 / Math.PI)
    const starAlpha = Math.max(0, Math.min(1, (-elevDeg - 6) / 8))
    starObj.mat.opacity = starAlpha
    starObj.mat.transparent = true

    updateCelestials(celest, lat, lon, weatherState.state)
    updateClouds(clouds, dt, weatherState.state, sunPos.altitude)
    updateLights(lights, lat, lon, weatherState.state)
    updateHouseNight(house, lat, lon)
    updateRain(rain, dt, weatherState.rainIntensity ?? 0)
    updateSnow(snow, dt, weatherState.snowIntensity ?? 0, elapsed)
    updateFog(fog, weatherState.state)
    updateLightning(lights, dt, weatherState.state)
    updateCamera(camera, controls, elapsed, dt, interactionState)

    renderer.render(scene, camera)
  }
  animate()

  // Kick off weather
  async function init() {
    try {
      const { lat: la, lon: lo } = await resolveLocation()
      lat = la; lon = lo
      startWeatherPolling(lat, lon, w => {
        weatherState = w
        updateHud(w)
        onWeather?.(w)
      })
    } catch (e) {
      console.error('Weather init failed:', e)
      document.getElementById('hud').textContent = 'Weather unavailable'
    }
  }
  init()
}
