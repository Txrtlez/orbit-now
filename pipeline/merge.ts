import {
  epochToUnixMs,
  type Catalog,
  type CatalogMetadata,
  type CatalogRecord,
  type CatalogSource,
} from '../src/catalog/format';
import type { ElementSet } from './omm';
import type { SatcatRecord } from './satcat';
import type { SourceDefinition } from './sources';

/** A freshly downloaded and checked data set, ready to be merged. */
export interface SourceUpdate {
  readonly elementSets: readonly ElementSet[];
  /** When the download completed (ISO 8601, UTC). */
  readonly fetchedAt: string;
}

/** Freshly downloaded and checked descriptive records, ready to be merged. */
export interface MetadataUpdate {
  readonly records: readonly SatcatRecord[];
  /** When the download completed (ISO 8601, UTC). */
  readonly fetchedAt: string;
}

/** Descriptive data to merge alongside the orbital elements. */
export interface MetadataInput {
  /** The current descriptive sources. */
  readonly definitions: readonly SourceDefinition[];
  /** New data, keyed by source identifier. May be empty. */
  readonly updates: ReadonlyMap<string, MetadataUpdate>;
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
 * Descriptive data (object type, owner, launch date) is merged separately
 * and never changes which objects are in the catalog. Each object gets the
 * fields from this run's downloads if any of them lists it; otherwise it
 * keeps the fields it had in the previous catalog; otherwise its fields
 * are empty until a later download covers it.
 *
 * @param previous    the catalog currently published, or null if there is none
 * @param updates     new orbital elements, keyed by source identifier
 * @param definitions the current orbital-elements sources; defines the bit positions
 * @param generatedAt timestamp to record on the result (ISO 8601, UTC)
 * @param metadata    descriptive sources and any new data for them; omit if there are none
 */
export function mergeCatalog(
  previous: Catalog | null,
  updates: ReadonlyMap<string, SourceUpdate>,
  definitions: readonly SourceDefinition[],
  generatedAt: string,
  metadata?: MetadataInput,
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

  const merged = mergeMetadata(previous, records, metadata);
  return merged === null
    ? { generatedAt, sources, records }
    : { generatedAt, sources, records, metadata: merged };
}

/**
 * Work out the descriptive fields for the given records.
 *
 * @returns null if there is nothing to record: no descriptive sources are
 *          defined, or none has ever been downloaded
 */
function mergeMetadata(
  previous: Catalog | null,
  records: readonly CatalogRecord[],
  input: MetadataInput | undefined,
): CatalogMetadata | null {
  if (input === undefined || input.definitions.length === 0) {
    return null;
  }
  const previousMetadata = previous?.metadata;
  if (previousMetadata === undefined && input.updates.size === 0) {
    return null;
  }

  type Fields = Omit<SatcatRecord, 'noradId'>;
  const byNoradId = new Map<number, Fields>();
  // Oldest first, so that newer data overwrites older.
  if (previous !== null && previousMetadata !== undefined) {
    previous.records.forEach((record, index) => {
      byNoradId.set(record.noradId, {
        objectType: previousMetadata.objectType[index] ?? '',
        opsStatus: previousMetadata.opsStatus[index] ?? '',
        owner: previousMetadata.owner[index] ?? '',
        launchDate: previousMetadata.launchDate[index] ?? '',
      });
    });
  }
  for (const [sourceId, update] of input.updates) {
    if (!input.definitions.some((definition) => definition.id === sourceId)) {
      throw new Error(`Metadata supplied for unknown source "${sourceId}"`);
    }
    for (const { noradId, ...fields } of update.records) {
      byNoradId.set(noradId, fields);
    }
  }

  const previousSources = new Map(
    (previousMetadata?.sources ?? []).map((source) => [source.id, source]),
  );
  const sources: CatalogSource[] = input.definitions.map((definition) => {
    const update = input.updates.get(definition.id);
    const before = previousSources.get(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      provider: definition.provider,
      fetchedAt: update?.fetchedAt ?? before?.fetchedAt ?? null,
      // For descriptive sources this is the number of rows accepted from the last download.
      objectCount: update?.records.length ?? before?.objectCount ?? 0,
    };
  });

  const blank: Fields = { objectType: '', opsStatus: '', owner: '', launchDate: '' };
  const fields = records.map((record) => byNoradId.get(record.noradId) ?? blank);
  return {
    sources,
    objectType: fields.map((entry) => entry.objectType),
    opsStatus: fields.map((entry) => entry.opsStatus),
    owner: fields.map((entry) => entry.owner),
    launchDate: fields.map((entry) => entry.launchDate),
  };
}
