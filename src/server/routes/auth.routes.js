import { Router } from 'express';
import { createRateLimiter } from '../middleware/rateLimit.js';

// AUTH ONLY scopes. Google Drive permissions must NEVER be added here;
// a Drive import flow would use its own separate authorization route
// (see src/auth/drive.js, future, behind DRIVE_IMPORT_ENABLED).
export const AUTH_SCOPES = ['openid', 'email', 'profile'];

/** Names the exact missing env vars so a 503 is actionable, not cryptic. */
function oauthNotConfigured(config) {
  const missing = [
    ...(config.auth.google.clientId ? [] : ['GOOGLE_CLIENT_ID']),
    ...(config.auth.google.clientSecret ? [] : ['GOOGLE_CLIENT_SECRET']),
  ];
  return {
    error: {
      code: 'OAUTH_NOT_CONFIGURED',
      message: `Google sign-in is not configured on this server. Set ${missing.join(' and ')} in your hosting environment, then redeploy.`,
    },
  };
}

function safeReturnTo(value) {
  // Reject protocol-relative ('//x') AND backslash forms ('/\x') which
  // browsers normalize to '//' -> open redirect after login.
  return typeof value === 'string' && value.startsWith('/') && !/^\/[\\/]/.test(value) ? value : '/';
}

/**
 * Resolve the OAuth redirect URI for this request.
 * Uses the explicitly configured GOOGLE_CALLBACK_URL when present; otherwise
 * derives it from the actual request host, so deployments only need the
 * client id/secret and the matching redirect registered in Google Console.
 */
export function resolveCallbackUrl(config, req) {
  const configured = (config.auth.google.callbackUrl ?? '').trim();
  if (configured) return configured;
  const proto = req.protocol; // trust proxy is already configured for Railway
  const host = req.get('host');
  return `${proto}://${host}/auth/google/callback`;
}

export function authRoutes(config, passportInstance, oauthEnabled) {
  const router = Router();
  const limiter = createRateLimiter(config.limits.authRateLimit);

  router.get('/auth/google', limiter, (req, res, next) => {
    if (!oauthEnabled) return res.status(503).json(oauthNotConfigured(config));
    req.session.returnTo = safeReturnTo(req.query.returnTo);
    passportInstance.authenticate('google', { scope: AUTH_SCOPES, callbackURL: resolveCallbackUrl(config, req) })(
      req,
      res,
      next,
    );
  });

  router.get('/auth/google/callback', limiter, (req, res, next) => {
    if (!oauthEnabled) return res.status(503).json(oauthNotConfigured(config));
    passportInstance.authenticate(
      'google',
      { callbackURL: resolveCallbackUrl(config, req) },
      (err, user) => {
        if (err) return next(err);
        if (!user) return res.redirect('/auth/failure');
        const returnTo = safeReturnTo(req.session?.returnTo);
        // Session fixation mitigation: regenerate after the OAuth exchange,
        // then re-establish the login on the fresh session.
        req.session.regenerate((regenErr) => {
          if (regenErr) return next(regenErr);
          req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            res.redirect(returnTo);
          });
        });
      },
    )(req, res, next);
  });

  router.get('/auth/failure', (_req, res) => {
    res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Google sign-in failed or was cancelled' } });
  });

  // POST /auth/logout â€” XHR / fetch path; returns JSON {ok:true}.
  router.post('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => res.clearCookie('ims13.sid').json({ ok: true }));
    });
  });

  // GET /auth/logout â€” anchor / redirect path used by the admin.html sign-out
  // link. Destroys the session then redirects to home.
  router.get('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie('ims13.sid');
        res.redirect('/');
      });
    });
  });

  router.get('/auth/status', (req, res) => {
    res.json({
      authenticated: Boolean(req.user),
      user: req.user ? { name: req.user.name, email: req.user.email, role: req.user.role } : null,
    });
  });

  // GET /auth/google/diag — booleans ONLY (never secret values). Lets you
  // verify from a browser whether the running server sees the OAuth env vars,
  // and shows the exact redirect URI to register in Google Console.
  router.get('/auth/google/diag', (req, res) => {
    res.json({
      clientIdSet: Boolean(config.auth.google.clientId),
      clientSecretSet: Boolean(config.auth.google.clientSecret),
      callbackUrlSet: Boolean(config.auth.google.callbackUrl),
      oauthEnabled: Boolean(config.auth.google.clientId && config.auth.google.clientSecret),
      callbackUrlInUse: resolveCallbackUrl(config, req),
    });
  });

  // GET /auth/me â€” returns the current user object or 401.
  // Used by admin.js to identify who is signed in.
  router.get('/auth/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } });
    }
    res.json({ user: { name: req.user.name, email: req.user.email, role: req.user.role } });
  });

  return router;
}
