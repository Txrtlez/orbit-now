/**
 * Colours for the object groups.
 *
 * The four hues come from the Okabe-Ito palette, which was designed to stay
 * distinguishable under the common forms of colour blindness. Active
 * satellites, by far the largest group, get the near-white so that the
 * coloured debris clouds stand out against them.
 */
export type Rgb = readonly [number, number, number];

const GROUP_COLOURS: Readonly<Record<string, Rgb>> = {
  active: [240, 244, 250],
  'fengyun-1c-debris': [230, 159, 0], // orange
  'cosmos-2251-debris': [204, 121, 167], // reddish purple
  'iridium-33-debris': [0, 158, 115], // bluish green
  // The brightest objects that are not active satellites: spent rocket
  // stages and satellites no longer working. (Active ones keep the white.)
  visual: [150, 160, 175], // grey
};

/** Used for any group this file does not know about. */
const FALLBACK_COLOUR: Rgb = [150, 160, 175];

/** Groups in the order their colour takes precedence when an object belongs to several. */
const PRECEDENCE = [
  'fengyun-1c-debris',
  'cosmos-2251-debris',
  'iridium-33-debris',
  'active',
  'visual',
];

/** The display colour of a group, as red, green and blue from 0 to 255. */
export function colourOfGroup(groupId: string): Rgb {
  return GROUP_COLOURS[groupId] ?? FALLBACK_COLOUR;
}

/** The same colour as a CSS value. */
export function cssColourOfGroup(groupId: string): string {
  const [r, g, b] = colourOfGroup(groupId);
  return `rgb(${String(r)} ${String(g)} ${String(b)})`;
}

/**
 * Build the per-object colour array for the renderer: three bytes per object.
 *
 * @param sourceMasks for each object, the bit mask of groups it belongs to
 * @param groupIds    the group identifier for each bit, lowest bit first
 */
export function coloursForObjects(
  sourceMasks: ArrayLike<number>,
  groupIds: readonly string[],
): Uint8Array {
  // Work out the colour for every possible mask once, not once per object.
  const ranked = groupIds
    .map((id, bit) => ({ id, bit, rank: PRECEDENCE.indexOf(id) }))
    .sort((a, b) => (a.rank === -1 ? Infinity : a.rank) - (b.rank === -1 ? Infinity : b.rank));
  const cache = new Map<number, Rgb>();
  const colourOfMask = (mask: number): Rgb => {
    let colour = cache.get(mask);
    if (colour === undefined) {
      const winner = ranked.find((group) => (mask & (1 << group.bit)) !== 0);
      colour = winner === undefined ? FALLBACK_COLOUR : colourOfGroup(winner.id);
      cache.set(mask, colour);
    }
    return colour;
  };

  const colours = new Uint8Array(sourceMasks.length * 3);
  for (let i = 0; i < sourceMasks.length; i += 1) {
    colours.set(colourOfMask(sourceMasks[i] ?? 0), i * 3);
  }
  return colours;
}
