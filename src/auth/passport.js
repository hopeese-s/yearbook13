import { Passport } from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

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
          state: true, // CSRF protection: random state stored in + verified against the session
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
