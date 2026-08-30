/**
 * Metadata schema versioning (BUILD-PLAN.md Phase 3).
 * Records on disk may predate the current schema; migrate() upgrades them
 * on load so the repository always returns current-shape records.
 */
export const SCHEMA_VERSION = 1;

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function migrate(record) {
  if (typeof record !== 'object' || record === null || typeof record.id !== 'string') {
    return null; // unusable record; repository drops it
  }
  return Object.freeze({
    ...record,
    personIds: ensureArray(record.personIds),
    collections: ensureArray(record.collections),
    tags: ensureArray(record.tags),
    categories: ensureArray(record.categories),
    caption: record.caption ?? '',
    section: record.section ?? '',
    year: record.year ?? null,
    exifStripped: record.exifStripped ?? false,
    createdAt: record.createdAt ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  });
}
