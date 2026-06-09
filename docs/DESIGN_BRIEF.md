# Design Brief — Street View Coverage Explorer

The goal is a **professional, map-forward, lightly animated** web app that feels like a polished
data product, not a class project.

## How to use this with the screenshot loop

1. Drop your reference image(s) into `docs/design-reference/` (e.g. `reference-1.png`).
2. Tell Claude Code: *"Match the layout and styling in docs/design-reference/reference-1.png.
   Use the Playwright MCP to screenshot the running app and iterate until it closely matches."*
3. Claude Code writes UI → runs `npm run dev` → screenshots via Playwright → compares → repeats.

## Layout (default — override with your reference)

- **Full-bleed map** as the canvas (MapLibre dark style works well for data viz).
- **Left sidebar / control panel** (collapsible): region selector, layer toggle
  (Density / Age / Official vs. Unofficial / Gaps), and a color legend that updates per layer.
- **Top bar**: app name, the active region's headline stats (coverage %, avg age) pulled from `/api/stats`.
- **Bottom-right**: small stat card or age histogram (e.g. a sparkline).
- **Hover tooltip** on hexes/points showing count, age, official ratio.

## Aesthetic

- Dark theme, high-contrast data colors over a muted base map.
- Sequential color ramp for density/age (e.g. viridis/magma); diverging or categorical for official-vs-unofficial.
- Clean sans-serif (Inter or similar). Generous spacing. Subtle borders, not heavy boxes.

## Animation (Framer Motion) — tasteful, not flashy

- Panel/legend slide + fade on open/close.
- Smooth cross-fade when switching layers.
- Staggered fade-in of stat numbers on load (count-up effect).
- Map fly-to animation when changing region.

## Performance

- deck.gl handles large layers; keep React re-renders minimal (memoize layer data).
- Lazy-load point layer only at high zoom; show hexbins when zoomed out.

## Accessibility

- Keyboard-focusable controls, legible contrast, layer toggles usable without color alone (labels + patterns).
