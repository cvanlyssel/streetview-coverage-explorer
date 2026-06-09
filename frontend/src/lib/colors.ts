// Color ramps for the data layers and their legends.

export type RGB = [number, number, number]

interface Stop {
  t: number
  color: RGB
}

function interpolate(stops: Stop[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t))
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (x <= b.t) {
      const f = (x - a.t) / (b.t - a.t)
      return [
        Math.round(a.color[0] + (b.color[0] - a.color[0]) * f),
        Math.round(a.color[1] + (b.color[1] - a.color[1]) * f),
        Math.round(a.color[2] + (b.color[2] - a.color[2]) * f),
      ]
    }
  }
  return stops[stops.length - 1].color
}

function gradientCSS(stops: Stop[]): string {
  return `linear-gradient(to right, ${stops
    .map((s) => `rgb(${s.color.join(',')}) ${s.t * 100}%`)
    .join(', ')})`
}

// --- Density (heat ramp, t = normalized coverage_density) ---------------------

const HEAT_STOPS: Stop[] = [
  { t: 0.0, color: [37, 99, 235] }, // blue
  { t: 0.25, color: [34, 211, 238] }, // cyan
  { t: 0.5, color: [74, 222, 128] }, // green
  { t: 0.7, color: [250, 204, 21] }, // yellow
  { t: 0.85, color: [249, 115, 22] }, // orange
  { t: 1.0, color: [239, 68, 68] }, // red
]

export const heatColor = (t: number): RGB => interpolate(HEAT_STOPS, t)
export const HEAT_GRADIENT_CSS = gradientCSS(HEAT_STOPS)
export const HEAT_COLOR_RANGE: RGB[] = HEAT_STOPS.map((s) => s.color)

// --- Age (viridis-like, t = avg_age_years / 10; stale imagery pops) -----------

const AGE_STOPS: Stop[] = [
  { t: 0.0, color: [70, 44, 122] }, // fresh: muted purple, recedes on the dark map
  { t: 0.35, color: [56, 102, 148] },
  { t: 0.6, color: [33, 145, 140] },
  { t: 0.8, color: [122, 209, 81] },
  { t: 1.0, color: [253, 231, 37] }, // stale: bright yellow stands out
]

export const ageColor = (ageYears: number): RGB => interpolate(AGE_STOPS, ageYears / 10)
export const AGE_GRADIENT_CSS = gradientCSS(AGE_STOPS)

// --- Official vs unofficial (diverging, t = official_ratio) -------------------

const OFFICIAL_STOPS: Stop[] = [
  { t: 0.0, color: [251, 146, 60] }, // mostly user photospheres
  { t: 0.5, color: [192, 132, 252] },
  { t: 1.0, color: [96, 165, 250] }, // mostly Google car/trekker
]

export const officialColor = (ratio: number): RGB => interpolate(OFFICIAL_STOPS, ratio)
export const OFFICIAL_GRADIENT_CSS = gradientCSS(OFFICIAL_STOPS)

// --- Gaps ----------------------------------------------------------------------

export const GAP_COLOR: RGB = [239, 68, 68]
