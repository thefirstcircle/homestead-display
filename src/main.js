import { initScene } from './scene3d.js'
import { config } from './config.js'
import { initStats, updateOutsideStats, startHAPolling } from './ha-stats.js'

window.__homesteadConfig = config

// Pixel-art canvas — rendered at 320×180, CSS-upscaled to fill viewport
const canvas = document.createElement('canvas')
canvas.width  = config.display.width
canvas.height = config.display.height
canvas.style.display        = 'block'
canvas.style.width          = '100vw'
canvas.style.height         = '100vh'
canvas.style.imageRendering = 'pixelated'
canvas.style.objectFit      = 'cover'
document.getElementById('app').appendChild(canvas)

// Stats panel (left overlay)
initStats()

// 3D scene — weather callback also drives the outside stat
initScene(canvas, (weather) => {
  updateOutsideStats(weather.tempC, weather.label)
})

// Home Assistant polling — activate by filling in config.homeAssistant
if (config.homeAssistant?.url && config.homeAssistant?.token) {
  startHAPolling(config.homeAssistant.url, config.homeAssistant.token)
}
