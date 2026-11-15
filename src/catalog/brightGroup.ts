/**
 * Identifier of the catalog source that lists the brightest objects:
 * CelesTrak's group "visual", which its website calls "100 (or so)
 * Brightest" (read at https://celestrak.org/NORAD/elements/ on 2026-11-15).
 *
 * The data pipeline downloads the group under this identifier, and the app
 * uses membership of it to choose which satellites to predict passes for.
 */
export const BRIGHT_GROUP_ID = 'visual';
