// Heat-style sequential ramp used by the Density layer and its legend.
// t is 0..1 (normalized coverage_density).

export type RGB = [number, number, number]

const HEAT_STOPS: { t: number; color: RGB }[] = [
  { t: 0.0, color: [37, 99, 235] }, // blue
  { t: 0.25, color: [34, 211, 238] }, // cyan
  { t: 0.5, color: [74, 222, 128] }, // green
  { t: 0.7, color: [250, 204, 21] }, // yellow
  { t: 0.85, color: [249, 115, 22] }, // orange
  { t: 1.0, color: [239, 68, 68] }, // red
]

export function heatColor(t: number): RGB {
  const x = Math.min(1, Math.max(0, t))
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const a = HEAT_STOPS[i - 1]
    const b = HEAT_STOPS[i]
    if (x <= b.t) {
      const f = (x - a.t) / (b.t - a.t)
      return [
        Math.round(a.color[0] + (b.color[0] - a.color[0]) * f),
        Math.round(a.color[1] + (b.color[1] - a.color[1]) * f),
        Math.round(a.color[2] + (b.color[2] - a.color[2]) * f),
      ]
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1].color
}

export const HEAT_GRADIENT_CSS = `linear-gradient(to right, ${HEAT_STOPS.map(
  (s) => `rgb(${s.color.join(',')}) ${s.t * 100}%`,
).join(', ')})`

// For deck.gl HeatmapLayer's colorRange prop
export const HEAT_COLOR_RANGE: RGB[] = HEAT_STOPS.map((s) => s.color)
