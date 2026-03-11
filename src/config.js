/**
 * Homestead Display — user configuration
 *
 * Set lat/lon manually to skip the browser geolocation prompt.
 * Leave null to auto-detect on page load.
 *
 * Optional Home Assistant override (future feature):
 *   homeAssistant: {
 *     url: "http://homeassistant.local:8123",
 *     token: "your-long-lived-access-token",
 *     weatherEntity: "weather.home",
 *   }
 */
export const config = {
  location: {
    lat: 42.4973,
    lon: -72.6979,
    name: "Conway, MA",
  },
  weather: {
    updateInterval: 15 * 60 * 1000,  // fetch new data every 15 min
    scorchingTemp: 35,                // °C — above this = scorching visuals
  },
  display: {
    // Base pixel-art resolution. Scales up to fill screen with integer zoom.
    width: 320,
    height: 180,
  },
  homeAssistant: null,
}
