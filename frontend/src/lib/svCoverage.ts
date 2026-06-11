// Country-level Street View coverage classes for the globe landing page.
//
// Compiled by hand (June 2026) from Google's public coverage map and the
// GeoGuessr community's coverage meta. Deliberately approximate — it drives
// a landing-page choropleth, not analysis. Keyed by Natural Earth ADM0_A3
// (not ISO_A3, which Natural Earth leaves as -99 for France and Norway).
// Anything unlisted renders as 'none'.

import type { RGB } from './colors'

export type CoverageClass = 'official' | 'limited' | 'unofficial' | 'none'

const OFFICIAL = [
  // Americas
  'USA', 'CAN', 'MEX', 'GTM', 'SLV', 'CRI', 'PAN', 'DOM', 'COL', 'ECU',
  'PER', 'BOL', 'CHL', 'ARG', 'URY', 'BRA',
  // Europe
  'ISL', 'NOR', 'SWE', 'FIN', 'DNK', 'GBR', 'IRL', 'NLD', 'BEL', 'LUX',
  'FRA', 'ESP', 'PRT', 'ITA', 'CHE', 'AUT', 'DEU', 'POL', 'CZE', 'SVK',
  'HUN', 'SVN', 'HRV', 'SRB', 'MNE', 'MKD', 'ALB', 'GRC', 'BGR', 'ROU',
  'EST', 'LVA', 'LTU', 'UKR', 'RUS', 'TUR', 'CYP',
  // Middle East + Asia
  'ISR', 'JOR', 'ARE', 'QAT', 'BHR', 'SAU', 'JPN', 'KOR', 'TWN', 'PHL',
  'IDN', 'MYS', 'SGP', 'THA', 'VNM', 'KHM', 'LAO', 'LKA', 'BGD', 'IND',
  'BTN', 'KGZ', 'KAZ',
  // Africa
  'ZAF', 'BWA', 'LSO', 'SWZ', 'SEN', 'GHA', 'NGA', 'KEN', 'UGA', 'RWA', 'TUN',
  // Oceania
  'AUS', 'NZL',
]

const LIMITED = [
  'GRL', 'ATA', 'MNG', 'BIH', 'MDA', 'PRY', 'MDG', 'TZA', 'EGY', 'HND',
  'JAM', 'HTI', 'OMN', 'KWT', 'NCL',
]

const UNOFFICIAL = [
  'CHN', 'PAK', 'NPL', 'IRN', 'IRQ', 'LBN', 'VEN', 'CUB', 'MAR', 'DZA',
  'UZB', 'GEO', 'ARM', 'AZE', 'NAM', 'ZWE', 'MOZ', 'ZMB', 'MMR', 'SUR',
  'NIC', 'PNG', 'FJI',
]

const CLASS_BY_A3 = new Map<string, CoverageClass>([
  ...OFFICIAL.map((a3) => [a3, 'official'] as const),
  ...LIMITED.map((a3) => [a3, 'limited'] as const),
  ...UNOFFICIAL.map((a3) => [a3, 'unofficial'] as const),
])

export function coverageClass(a3: string): CoverageClass {
  return CLASS_BY_A3.get(a3) ?? 'none'
}

// Same families as the in-app layers: blue = Google, orange = photospheres.
export const CLASS_COLORS: Record<CoverageClass, RGB> = {
  official: [59, 130, 246],
  limited: [34, 211, 238],
  unofficial: [251, 146, 60],
  none: [63, 63, 70],
}

export const CLASS_LABELS: Record<CoverageClass, string> = {
  official: 'Official Google coverage',
  limited: 'Limited / select areas',
  unofficial: 'Photospheres only',
  none: 'No Street View',
}
