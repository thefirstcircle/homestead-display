/**
 * WMO Weather Interpretation Codes → internal weather states
 * https://open-meteo.com/en/docs#weathervariables
 */

export const WMO_STATES = {
  0:  'clear',
  1:  'mostly-clear',
  2:  'partly-cloudy',
  3:  'overcast',
  45: 'fog',
  48: 'fog',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  56: 'drizzle',
  57: 'drizzle',
  61: 'rain',
  63: 'rain',
  65: 'heavy-rain',
  66: 'rain',
  67: 'heavy-rain',
  71: 'snow',
  73: 'snow',
  75: 'heavy-snow',
  77: 'snow',
  80: 'rain',
  81: 'rain',
  82: 'heavy-rain',
  85: 'snow',
  86: 'heavy-snow',
  95: 'thunderstorm',
  96: 'thunderstorm',
  99: 'thunderstorm',
}

export const STATE_META = {
  'clear':         { label: 'Clear',          cloudCover: 0,   rainIntensity: 0, snowIntensity: 0 },
  'mostly-clear':  { label: 'Mostly Clear',   cloudCover: 0.2, rainIntensity: 0, snowIntensity: 0 },
  'partly-cloudy': { label: 'Partly Cloudy',  cloudCover: 0.5, rainIntensity: 0, snowIntensity: 0 },
  'overcast':      { label: 'Overcast',        cloudCover: 1.0, rainIntensity: 0, snowIntensity: 0 },
  'fog':           { label: 'Foggy',           cloudCover: 1.0, rainIntensity: 0, snowIntensity: 0 },
  'drizzle':       { label: 'Drizzle',         cloudCover: 0.8, rainIntensity: 0.2, snowIntensity: 0 },
  'rain':          { label: 'Rain',            cloudCover: 1.0, rainIntensity: 0.6, snowIntensity: 0 },
  'heavy-rain':    { label: 'Heavy Rain',      cloudCover: 1.0, rainIntensity: 1.0, snowIntensity: 0 },
  'snow':          { label: 'Snow',            cloudCover: 0.9, rainIntensity: 0, snowIntensity: 0.5 },
  'heavy-snow':    { label: 'Heavy Snow',      cloudCover: 1.0, rainIntensity: 0, snowIntensity: 1.0 },
  'thunderstorm':  { label: 'Thunderstorm',    cloudCover: 1.0, rainIntensity: 1.0, snowIntensity: 0 },
  'scorching':     { label: 'Scorching',       cloudCover: 0,   rainIntensity: 0, snowIntensity: 0 },
}

export function wmoToState(code, tempC, scorchingThreshold = 35) {
  const base = WMO_STATES[code] ?? 'clear'
  if (base === 'clear' && tempC >= scorchingThreshold) return 'scorching'
  return base
}
