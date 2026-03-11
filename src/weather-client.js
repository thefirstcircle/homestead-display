import { config } from './config.js'
import { wmoToState, STATE_META } from './weather-codes.js'

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'

/**
 * Resolve lat/lon: use config values, or fall back to browser geolocation.
 * Returns { lat, lon }.
 */
export async function resolveLocation() {
  if (config.location.lat !== null && config.location.lon !== null) {
    return { lat: config.location.lat, lon: config.location.lon }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      // Default to London if no geolocation
      console.warn('Geolocation unavailable, defaulting to London')
      resolve({ lat: 51.5074, lon: -0.1278 })
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => {
        console.warn('Geolocation denied, defaulting to London:', err.message)
        resolve({ lat: 51.5074, lon: -0.1278 })
      },
      { timeout: 8000 }
    )
  })
}

/**
 * Fetch current weather from Open-Meteo and return a normalised state object.
 */
export async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,weather_code,apparent_temperature',
    wind_speed_unit: 'ms',
    forecast_days: 1,
  })
  const res = await fetch(`${OPEN_METEO}?${params}`)
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`)
  const data = await res.json()

  const current = data.current
  const code    = current.weather_code
  const tempC   = current.temperature_2m
  const state   = wmoToState(code, tempC, config.weather.scorchingTemp)
  const meta    = STATE_META[state]

  return {
    state,
    code,
    tempC,
    label:    meta.label,
    cloudCover:    meta.cloudCover,
    rainIntensity: meta.rainIntensity,
    snowIntensity: meta.snowIntensity,
    isScorching: state === 'scorching',
    isThunder:   state === 'thunderstorm',
    lat,
    lon,
    fetchedAt: Date.now(),
  }
}

/**
 * Start a repeating weather poll. Calls onUpdate(weather) immediately and
 * then every config.weather.updateInterval ms.
 * Returns a cancel function.
 */
export function startWeatherPolling(lat, lon, onUpdate) {
  let handle = null
  const tick = async () => {
    try {
      const weather = await fetchWeather(lat, lon)
      onUpdate(weather)
    } catch (e) {
      console.error('Weather fetch failed:', e)
    }
  }
  tick()
  handle = setInterval(tick, config.weather.updateInterval)
  return () => clearInterval(handle)
}
