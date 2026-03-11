Great question. You've got two parallel tracks — the house model and the terrain — and a few good options for each:

House
Best fit for this aesthetic: MagicaVoxel (free)

It's literally voxel/pixel-art 3D
Export as .obj or .glb
Looks perfect at the low 320×180 render resolution
Alternatively: Blockbench (browser-based, Minecraft-style, very approachable)
Import in Three.js is straightforward:


import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
loader.load('/assets/house.glb', gltf => {
  scene.add(gltf.scene)
  // remove the procedural house group
})
Terrain
Option A — Real elevation data for Conway MA (best for "your homestead")

Download a heightmap from USGS TNM (free 1m/3m lidar DEMs)
Or use OpenTopography
Convert to a PNG heightmap → Three.js PlaneGeometry with displacement
Option B — Stylized in Blender (more control)

Model a simplified version of your actual land contours
Export .glb, import with GLTFLoader
Option C — Photogrammetry (most realistic)

~30-50 photos of house/land → Meshroom or RealityCapture → .glb
Decimate the mesh in Blender to keep it low-poly
Practical starting point
MagicaVoxel → .glb → GLTFLoader is the path of least resistance and will look great with the current pixel-art-3D aesthetic. The procedural house in buildHouse() can just be swapped out when you're ready — the rest of the scene (weather, sky, lighting, camera) stays exactly as-is.

Want me to wire in the GLTFLoader and asset-loading scaffolding now so it's ready when you have a model?

Can you put some of this stuff in .claude so i can continue when your context window is exhausted?
Write MEMORY.md
90 lines
# Homestead Display — Project Memory

## Stack
- **Three.js** (^0.169) + **Vite 5** — 3D renderer, pixel-art upscaled
- **suncalc** — real sun/moon position for day/night cycle
- **Open-Meteo** — free weather API, no key needed (lat/lon in config.js)
- No Phaser (was tried, switched to Three.js for 3D)

## Architecture
- Canvas rendered at **320×180** internally, CSS-upscaled to fill viewport
- `canvas.style.imageRendering = 'pixelated'` for chunky pixel-art look
- `antialias: false`, `pixelRatio: 1` on renderer
- Weather polled every 15 min via `startWeatherPolling()` in weather-client.js
- Location hardcoded: **Conway, MA** (lat: 42.4973, lon: -72.6979) in config.js

## Key Files
- [src/config.js](src/config.js) — lat/lon, scorching threshold, display size
- [src/weather-client.js](src/weather-client.js) — Open-Meteo fetch + geolocation fallback
- [src/weather-codes.js](src/weather-codes.js) — WMO code → state string + metadata
- [src/main.js](src/main.js) — creates canvas, calls initScene()
- [src/scene3d.js](src/scene3d.js) — **entire Three.js scene** (~650 lines)
- [src/scenes/HomesteadScene.js](src/scenes/HomesteadScene.js) — OLD Phaser scene, unused

## scene3d.js Structure
Functions (all in one file):
- `buildSky(scene)` — fullscreen ShaderMaterial gradient quad, returns uniforms
- `buildStars(scene)` — 120 Points on upper hemisphere
- `buildCelestials(scene)` — sun + moon SphereGeometry, follows SunCalc
- `buildClouds(scene)` — 5 BoxGeometry clouds that drift
- `buildGround(scene)` — PlaneGeometry + path
- `buildHills(scene)` — background BoxGeometry hills
- `buildHouse(scene)` — BoxGeometry body + ExtrudeGeometry pitched roof + chimney + door + windows with emissive night glow + PointLight
- `buildTrees(scene)` — stacked ConeGeometry pine trees
- `buildRain(scene)` — LineSegments, updated per-frame
- `buildSnow(scene)` — Points, drifts via sine wave
- `buildFog(scene)` — FogExp2 on scene
- `buildLights(scene)` — AmbientLight + DirectionalLight
- `initCamera(canvas)` — PerspectiveCamera fov=50 at (0, 2.2, 5.5) looking at (0, 0.5, 0)
- `initControls(camera, canvas)` — OrbitControls with limits + damping
- `updateCamera(...)` — **idle breathing animation** (slow sine drift) + auto-return after 9s
- `initScene(canvas)` — main entry, wires everything, runs animate loop

## Camera / 3D Interaction
- **Idle mode**: slow compound sine breathing (periods ~40s, 55s, 32s), amplitude ~0.45 units
- **User orbit**: drag to pivot/tilt; limits prevent going underground or behind house
- **Auto-return**: after 9s idle, camera lerps back to default position, breathing resumes
- Default camera: `(0, 2.2, 5.5)` → target `(0, 0.5, 0)`

## Weather States
clear, mostly-clear, partly-cloudy, overcast, fog, drizzle, rain, heavy-rain,
snow, heavy-snow, thunderstorm, scorching (clear + temp ≥ 35°C)

## House Geometry (Three.js units)
- Body: BoxGeometry(3, 2, 2) at y=1
- Roof: ExtrudeGeometry prism, width=3.4, peak height=1.1, depth=2.4, at y=2
- Chimney: BoxGeometry(0.3, 0.9, 0.3) at (0.7, 2.9, -0.2)
- Door: at (0, 0.51, 1.04), 0.52×0.94
- Windows: at (±1.0, 1.3, 1.04), emissive warm glow at night
- Window PointLight: (0, 1.2, 1.2), intensity 0 day / 1.5 night

## Night Lighting (important — was too dark, fixed)
- Night ambient: color 0x4060a8, intensity 0.55 (moonlit, must stay bright enough to see house)
- Sun directional: `Math.max(0, elevDeg / 60) * 1.6` — goes to 0 at night
- Windows: emissive 0xffc87a, emissiveIntensity 0.7 when sun.altitude < -0.05

## Dev Commands
```bash
npm run dev      # hot-reload dev server → http://192.168.1.10:3000
npm run build    # production build → dist/
npm run preview  # serve dist/ locally
```

## Vite Config Notes
- Port: 3000
- allowedHosts: ['code.bondstreet.dev']
- base: './'

## Next Steps / Roadmap
1. **Import real house model** — best path: MagicaVoxel → .glb → GLTFLoader
   - `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`
   - Drop into scene, remove procedural `buildHouse()` group
2. **Real terrain** — USGS TNM heightmap for Conway MA → PlaneGeometry displacement
3. **Home Assistant override** — config.homeAssistant = { url, token, weatherEntity }
4. **Window light toggle** — config-driven per-window on/off from HA
5. **Chimney smoke** — particle system active in cold weather
6. **Ambient sound** — Web Audio API, rain/wind/crickets by weather state

## Known Dead Files
- `src/scenes/HomesteadScene.js` — old Phaser 2D scene, not imported, safe to delete
Done. That covers everything — stack, file structure, all function names, the 3D geometry dimensions, the night lighting fix history, camera/orbit setup, weather states, dev commands, and the full roadmap including the GLTFLoader path for importing your house model.

Next conversation will load this automatically and pick up right where we left off.

