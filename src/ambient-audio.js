/**
 * ambient-audio.js — Weather-reactive ambient soundscape via Howler.js
 *
 * Sound files go in public/sounds/:
 *   rain.mp3      looping rain (freesound.org search "rain loop CC0")
 *   wind.mp3      looping wind (freesound.org search "wind ambience loop CC0")
 *   crickets.mp3  looping night insects (freesound.org search "crickets loop CC0")
 *   thunder.mp3   single thunder rumble (freesound.org search "thunder CC0")
 *
 * All three loops run continuously at volume 0 and crossfade when weather changes.
 * Master volume is controlled via Howler.volume() (the slider calls setVolume()).
 * Browser autoplay policy is handled automatically by Howler — audio starts
 * after the first user interaction with the page.
 */

import { Howl, Howler } from 'howler'

// ─── Sound setup ──────────────────────────────────────────────────────────────

function makeLoop(src) {
  return new Howl({
    src,
    loop: true,
    volume: 0,
    onloaderror: (_, err) => console.warn(`ambient-audio: could not load ${src[0]}`, err),
  })
}

const sounds = {
  rain:     makeLoop(['sounds/rain.mp3']),
  wind:     makeLoop(['sounds/wind.mp3']),
  crickets: makeLoop(['sounds/crickets.mp3']),
}

const thunder = new Howl({
  src: ['sounds/thunder.mp3'],
  volume: 0.85,
  onloaderror: (_, err) => console.warn('ambient-audio: could not load sounds/thunder.mp3', err),
})

// ─── Weather → volume levels ──────────────────────────────────────────────────
// Values are 0–1 relative to master; master volume applied via Howler.volume()

const LEVELS = {
  'clear':         { rain: 0,   wind: 0,    crickets: 0.8 },
  'mostly-clear':  { rain: 0,   wind: 0,    crickets: 0.5 },
  'partly-cloudy': { rain: 0,   wind: 0.15, crickets: 0.2 },
  'overcast':      { rain: 0,   wind: 0.5,  crickets: 0   },
  'fog':           { rain: 0,   wind: 0.3,  crickets: 0   },
  'drizzle':       { rain: 0.4, wind: 0.3,  crickets: 0   },
  'rain':          { rain: 0.8, wind: 0.5,  crickets: 0   },
  'heavy-rain':    { rain: 1.0, wind: 0.8,  crickets: 0   },
  'snow':          { rain: 0,   wind: 0.5,  crickets: 0   },
  'heavy-snow':    { rain: 0,   wind: 0.8,  crickets: 0   },
  'thunderstorm':  { rain: 0.9, wind: 0.7,  crickets: 0   },
  'scorching':     { rain: 0,   wind: 0,    crickets: 0.5 },
}

const FADE_MS = 2000

// ─── State ────────────────────────────────────────────────────────────────────

let _started = false
let _currentState = 'clear'
let _thunderTimeout = null

function ensureStarted() {
  if (_started) return
  _started = true
  Object.values(sounds).forEach(s => s.play())
}

// ─── Thunder scheduling ───────────────────────────────────────────────────────

function scheduleThunder() {
  const delay = 5000 + Math.random() * 15000
  _thunderTimeout = setTimeout(() => {
    if (_currentState === 'thunderstorm') {
      thunder.play()
      scheduleThunder()
    }
  }, delay)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call this whenever the weather state changes.
 * Crossfades all loops to the target levels for that state.
 */
export function setWeatherAudio(state) {
  ensureStarted()
  _currentState = state
  const lvl = LEVELS[state] ?? LEVELS['clear']
  Object.entries(lvl).forEach(([k, v]) => {
    sounds[k].fade(sounds[k].volume(), v, FADE_MS)
  })

  if (state === 'thunderstorm' && _thunderTimeout == null) {
    scheduleThunder()
  } else if (state !== 'thunderstorm' && _thunderTimeout != null) {
    clearTimeout(_thunderTimeout)
    _thunderTimeout = null
  }
}

/**
 * Set master volume (0–1). Affects all ambient sounds instantly.
 * Called by the volume slider in the stats panel.
 */
export function setVolume(v) {
  Howler.volume(Math.max(0, Math.min(1, v)))
}

export function getVolume() {
  return Howler.volume()
}
