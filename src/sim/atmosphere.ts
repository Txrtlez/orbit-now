/**
 * How thin the air is at a given height.
 *
 * SIMPLIFICATION. This is the "exponential atmosphere": a table of
 * densities at a few heights, joined by exponential curves. It has no day
 * and night, no seasons, no latitude and no solar cycle, all of which
 * change the real density at satellite heights by large factors. It is
 * used because it is simple, standard and quick, not because it is right.
 *
 * The table is the one printed as Table 8-4 in Vallado, "Fundamentals of
 * Astrodynamics and Applications" (from the U.S. Standard Atmosphere 1976
 * and CIRA-72). The book was not available; the values were taken on
 * 2026-11-15 from MIT's MOCAT-MC (`densityexp_vec.m`, commit 138681e), which
 * cites that table and page 537, and they agree with my memory of it.
 */

/** Base height (km), density there (kg/m^3) and scale height (km), for each band. */
const TABLE: readonly (readonly [number, number, number])[] = [
  [0, 1.225, 7.249],
  [25, 3.899e-2, 6.349],
  [30, 1.774e-2, 6.682],
  [40, 3.972e-3, 7.554],
  [50, 1.057e-3, 8.382],
  [60, 3.206e-4, 7.714],
  [70, 8.77e-5, 6.549],
  [80, 1.905e-5, 5.799],
  [90, 3.396e-6, 5.382],
  [100, 5.297e-7, 5.877],
  [110, 9.661e-8, 7.263],
  [120, 2.438e-8, 9.473],
  [130, 8.484e-9, 12.636],
  [140, 3.845e-9, 16.149],
  [150, 2.07e-9, 22.523],
  [180, 5.464e-10, 29.74],
  [200, 2.789e-10, 37.105],
  [250, 7.248e-11, 45.546],
  [300, 2.418e-11, 53.628],
  [350, 9.518e-12, 53.298],
  [400, 3.725e-12, 58.515],
  [450, 1.585e-12, 60.828],
  [500, 6.967e-13, 63.822],
  [600, 1.454e-13, 71.835],
  [700, 3.614e-14, 88.667],
  [800, 1.17e-14, 124.64],
  [900, 5.245e-15, 181.05],
  [1000, 3.019e-15, 268.0],
];

/**
 * Density of the air, in kg/m^3, at a height in km above a spherical Earth.
 * Above 1,000 km the last band's curve is simply continued.
 */
export function airDensity(heightKm: number): number {
  const h = Math.max(0, heightKm);
  let row = TABLE[0];
  for (const candidate of TABLE) {
    if (candidate[0] > h) {
      break;
    }
    row = candidate;
  }
  if (row === undefined) {
    return 0;
  }
  return row[1] * Math.exp((row[0] - h) / row[2]);
}

/**
 * The simulator's stand-in for the solar cycle: the whole table is
 * multiplied by one number.
 *
 * ASSUMPTION, not data. The Sun's activity changes the density at these
 * heights several-fold over its eleven-year cycle, and by different amounts
 * at different heights; one multiplier cannot represent that. The three
 * values are chosen to span a factor of nine and are not taken from any
 * source.
 */
export const SOLAR_SETTINGS = [
  { id: 'quiet', label: 'Quiet Sun: air three times thinner', factor: 1 / 3 },
  { id: 'average', label: 'Average: the table as it is', factor: 1 },
  { id: 'active', label: 'Active Sun: air three times thicker', factor: 3 },
] as const;

export type SolarSettingId = (typeof SOLAR_SETTINGS)[number]['id'];
