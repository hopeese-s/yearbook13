/**
 * PhotoRepository interface (BUILD-PLAN.md Phase 3 contract).
 *
 * This is the ONLY metadata boundary exposed to routes and domain logic.
 * All JSON access lives behind it so the backing store can become SQL later
 * (DB_DRIVER=sql) without touching domain code.
 *
 * Implementations provide (all async):
 *   async createPhoto(record)            -> record
 *   async getPhoto(id)                   -> record | null
 *   async listPhotos(query)              -> { items, total, limit, offset }
 *   async updatePhoto(id, patch)         -> record | null
 *   async deletePhoto(id)                -> boolean
 *   async countPhotos()                  -> number
 *
 * listPhotos query: { collection?, tag?, category?, section?, year?,
 *                     personId?, sort: 'newest'|'oldest', limit, offset }
 */
export function assertRepository(repository) {
  const required = ['createPhoto', 'getPhoto', 'listPhotos', 'updatePhoto', 'deletePhoto', 'countPhotos'];
  const missing = required.filter((method) => typeof repository[method] !== 'function');
  if (missing.length > 0) {
    throw new Error(`PhotoRepository implementation is missing methods: ${missing.join(', ')}`);
  }
  return repository;
}
