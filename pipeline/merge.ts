import {
  epochToUnixMs,
  type Catalog,
  type CatalogRecord,
  type CatalogSource,
} from '../src/catalog/format';
import type { ElementSet } from './omm';
import type { SourceDefinition } from './sources';

/** A freshly downloaded and checked data set, ready to be merged. */
export interface SourceUpdate {
  readonly elementSets: readonly ElementSet[];
  /** When the download completed (ISO 8601, UTC). */
  readonly fetchedAt: string;
}

/** The orbital elements of a catalog record, without its source membership. */
function withoutMask(record: CatalogRecord): ElementSet {
  return {
    noradId: record.noradId,
    name: record.name,
    objectId: record.objectId,
    epochDay: record.epochDay,
    epochMicros: record.epochMicros,
    meanMotion: record.meanMotion,
    eccentricity: record.eccentricity,
    inclination: record.inclination,
    raan: record.raan,
    argPericenter: record.argPericenter,
    meanAnomaly: record.meanAnomaly,
    bstar: record.bstar,
  };
}

/**
 * Combine the previous catalog with whichever sources were refreshed in this
 * run.
 *
 * A source that was refreshed is replaced completely: objects it no longer
 * lists lose their membership of it. A source that was not refreshed (because
 * the download was refused, or it was too soon to ask again) keeps exactly
 * the objects it had. An object that ends up belonging to no source is
 * removed. When two sources both list an object, the element set with the
 * later epoch is kept.
 *
 * @param previous    the catalog currently published, or null if there is none
 * @param updates     new data, keyed by source identifier
 * @param definitions the current list of sources; defines the bit positions
 * @param generatedAt timestamp to record on the result (ISO 8601, UTC)
 */
export function mergeCatalog(
  previous: Catalog | null,
  updates: ReadonlyMap<string, SourceUpdate>,
  definitions: readonly SourceDefinition[],
  generatedAt: string,
): Catalog {
  if (definitions.length > 31) {
    // Bitwise operators in JavaScript work on 32-bit signed integers.
    throw new Error('At most 31 sources are supported by the sourceMask encoding');
  }
  const bitOf = new Map(definitions.map((definition, index) => [definition.id, 1 << index]));

  interface Entry {
    elements: ElementSet;
    mask: number;
  }
  const entries = new Map<number, Entry>();

  // 1. Start from the previous catalog, translating its membership bits to
  //    the current source order and dropping memberships of sources that no
  //    longer exist or that are being replaced in this run.
  if (previous !== null) {
    const translation = previous.sources.map((source) =>
      updates.has(source.id) ? 0 : (bitOf.get(source.id) ?? 0),
    );
    for (const record of previous.records) {
      let mask = 0;
      translation.forEach((bit, previousIndex) => {
        if ((record.sourceMask & (1 << previousIndex)) !== 0) {
          mask |= bit;
        }
      });
      if (mask !== 0) {
        entries.set(record.noradId, { elements: withoutMask(record), mask });
      }
    }
  }

  // 2. Add the refreshed sources.
  for (const [sourceId, update] of updates) {
    const bit = bitOf.get(sourceId);
    if (bit === undefined) {
      throw new Error(`Update supplied for unknown source "${sourceId}"`);
    }
    for (const elements of update.elementSets) {
      const existing = entries.get(elements.noradId);
      if (existing === undefined) {
        entries.set(elements.noradId, { elements, mask: bit });
        continue;
      }
      const existingMs = epochToUnixMs(existing.elements.epochDay, existing.elements.epochMicros);
      const candidateMs = epochToUnixMs(elements.epochDay, elements.epochMicros);
      entries.set(elements.noradId, {
        elements: candidateMs >= existingMs ? elements : existing.elements,
        mask: existing.mask | bit,
      });
    }
  }

  const records: CatalogRecord[] = [...entries.values()]
    .map((entry) => ({ ...entry.elements, sourceMask: entry.mask }))
    .sort((a, b) => a.noradId - b.noradId);

  const previousFetchedAt = new Map(
    (previous?.sources ?? []).map((source) => [source.id, source.fetchedAt]),
  );
  const sources: CatalogSource[] = definitions.map((definition, index) => ({
    id: definition.id,
    label: definition.label,
    provider: definition.provider,
    fetchedAt:
      updates.get(definition.id)?.fetchedAt ?? previousFetchedAt.get(definition.id) ?? null,
    objectCount: records.filter((record) => (record.sourceMask & (1 << index)) !== 0).length,
  }));

  return { generatedAt, sources, records };
}
