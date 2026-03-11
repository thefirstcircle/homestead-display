import { initScene } from './scene3d.js'
import { config } from './config.js'

window.__homesteadConfig = config

// Create a low-res canvas and scale it up via CSS for pixel-art feel
const canvas = document.createElement('canvas')
canvas.width  = config.display.width
canvas.height = config.display.height
canvas.style.display        = 'block'
canvas.style.width          = '100vw'
canvas.style.height         = '100vh'
canvas.style.imageRendering = 'pixelated'
canvas.style.objectFit      = 'cover'
document.getElementById('app').appendChild(canvas)

initScene(canvas)
