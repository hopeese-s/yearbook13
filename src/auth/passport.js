import crypto from 'node:crypto';
import { Passport } from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

/**
 * Resilient OAuth state store that maintains a ring of recent valid CSRF tokens
 * in the session. Solves race conditions where double-clicking "Sign in",
 * link pre-fetching, or multiple tabs overwrite a single state token.
 */
export class ResilientSessionStore {
  constructor({ key = 'oauth2:accounts.google.com', maxStates = 5 } = {}) {
    this._key = key;
    this._maxStates = maxStates;
  }

  store(req, callback) {
    if (!req.session) {
      return callback(new Error('OAuth 2.0 authentication requires session support when using state'));
    }
    const state = crypto.randomBytes(18).toString('base64url');
    if (!req.session[this._key]) {
      req.session[this._key] = { states: [] };
    }
    const bucket = req.session[this._key];
    if (!Array.isArray(bucket.states)) {
      bucket.states = bucket.state ? [bucket.state] : [];
      delete bucket.state;
    }
    bucket.states.push(state);
    if (bucket.states.length > this._maxStates) {
      bucket.states.shift();
    }
    callback(null, state);
  }

  verify(req, providedState, callback) {
    if (!req.session) {
      return callback(new Error('OAuth 2.0 authentication requires session support when using state'));
    }
    const bucket = req.session[this._key];
    if (!bucket) {
      return callback(null, false, { message: 'Unable to verify authorization request state.' });
    }
    const list = Array.isArray(bucket.states) ? bucket.states : (bucket.state ? [bucket.state] : []);
    const index = list.indexOf(providedState);
    if (index === -1) {
      return callback(null, false, { message: 'Invalid authorization request state.' });
    }
    // Single-use token: remove the matched state to prevent replay attacks
    list.splice(index, 1);
    bucket.states = list;
    if (list.length === 0) {
      delete req.session[this._key];
    }
    return callback(null, true);
  }
}

/**
 * Map a Google profile to our minimal user record.
 * AUTH ONLY: this app never requests Drive scopes; access/refresh tokens
 * issued during sign-in are intentionally discarded, not stored.
 */
export function mapGoogleProfile(profile) {
  const email = profile?.emails?.[0]?.value?.toLowerCase() ?? '';
  return {
    googleSub: profile?.id ?? '',
    email,
    name: profile?.displayName ?? '',
    role: 'viewer',
  };
}

export function applyRole(user, adminEmails) {
  return { ...user, role: adminEmails.includes(user.email) ? 'admin' : 'viewer' };
}

/**
 * Create a configured passport instance (per-app, not the global singleton).
 * Returns { passport, enabled } - `enabled` is false until OAuth credentials
 * are provided, in which case auth routes respond 503 instead of crashing boot.
 */
export function createPassport(config) {
  const instance = new Passport();
  const enabled = Boolean(config.auth.google.clientId && config.auth.google.clientSecret);

  if (enabled) {
    instance.use(
      new GoogleStrategy(
        {
          clientID: config.auth.google.clientId,
          clientSecret: config.auth.google.clientSecret,
          callbackURL: config.auth.google.callbackUrl,
          store: new ResilientSessionStore(),
        },
        (_accessToken, _refreshToken, profile, done) => {
          // Tokens deliberately ignored: sign-in grants identity only.
          try {
            done(null, applyRole(mapGoogleProfile(profile), config.auth.adminEmails));
          } catch (err) {
            done(err);
          }
        },
      ),
    );
  }

  instance.serializeUser((user, done) => done(null, user));
  instance.deserializeUser((user, done) => done(null, user));

  return { passport: instance, enabled };
}
