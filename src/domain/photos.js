/**
 * Photo domain model - PURE logic, no Express, no fs (BUILD-PLAN.md contract).
 * Future yearbook sections are supported via collections/tags/categories/sections
 * (approved data model R5), so new features never require a schema rewrite.
 */

export const CAPTION_MAX_LENGTH = 300;
export const LABEL_MAX_LENGTH = 50;

function normalizeLabels(value, errors, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings`);
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      errors.push(`${field} entries must be strings`);
      return [];
    }
    const label = item.trim();
    if (!label) continue;
    if (label.length > LABEL_MAX_LENGTH) {
      errors.push(`${field} entries must be <= ${LABEL_MAX_LENGTH} characters`);
      return [];
    }
    const dedupeKey = label.toLowerCase();
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      out.push(label);
    }
  }
  return out;
}

/**
 * Validate + normalize photo metadata input.
 * Returns { value, errors } - value is undefined when errors is non-empty.
 */
export function validatePhotoInput(input = {}) {
  const errors = [];

  const caption = input.caption === undefined || input.caption === null ? '' : String(input.caption).trim();
  if (caption.length > CAPTION_MAX_LENGTH) {
    errors.push(`caption must be <= ${CAPTION_MAX_LENGTH} characters`);
  }

  const section = input.section === undefined || input.section === null ? '' : String(input.section).trim();
  if (section.length > LABEL_MAX_LENGTH) {
    errors.push(`section must be <= ${LABEL_MAX_LENGTH} characters`);
  }

  let year;
  if (input.year !== undefined && input.year !== null && input.year !== '') {
    year = Number(input.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      errors.push('year must be an integer between 1900 and 2200');
      year = undefined;
    }
  }

  const personIds = normalizeLabels(input.personIds, errors, 'personIds');
  const collections = normalizeLabels(input.collections, errors, 'collections');
  const tags = normalizeLabels(input.tags, errors, 'tags');
  const categories = normalizeLabels(input.categories, errors, 'categories');

  if (errors.length > 0) return { value: undefined, errors };
  return { value: { caption, section, year, personIds, collections, tags, categories }, errors };
}

/**
 * Assemble a full persisted record from validated metadata + file facts.
 * Storage keys and dimensions come from the image pipeline (Phase 4).
 */
export function createPhotoRecord(
  metadata,
  { id, filename, storageKey, thumbKey, width, height, thumbWidth, thumbHeight, createdAt },
) {
  return Object.freeze({
    id,
    filename,
    storageKey,
    thumbKey,
    personIds: metadata.personIds,
    collections: metadata.collections,
    tags: metadata.tags,
    categories: metadata.categories,
    caption: metadata.caption,
    section: metadata.section,
    year: metadata.year,
    width,
    height,
    thumbWidth,
    thumbHeight,
    exifStripped: true,
    createdAt,
    updatedAt: createdAt,
    schemaVersion: 1,
  });
}

/** Whitelist-based patch merge for metadata edits (id/keys/dimensions immutable here). */
export function applyPhotoPatch(record, patch = {}) {
  const { value, errors } = validatePhotoInput({
    caption: patch.caption ?? record.caption,
    section: patch.section ?? record.section,
    year: patch.year ?? record.year,
    personIds: patch.personIds ?? record.personIds,
    collections: patch.collections ?? record.collections,
    tags: patch.tags ?? record.tags,
    categories: patch.categories ?? record.categories,
  });
  if (errors.length > 0) return { value: undefined, errors };
  return { value: { ...record, ...value, updatedAt: new Date().toISOString() }, errors };
}
