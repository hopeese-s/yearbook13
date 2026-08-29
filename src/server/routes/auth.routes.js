import { Router } from 'express';
import { createRateLimiter } from '../middleware/rateLimit.js';

// AUTH ONLY scopes. Google Drive permissions must NEVER be added here;
// a Drive import flow would use its own separate authorization route
// (see src/auth/drive.js, future, behind DRIVE_IMPORT_ENABLED).
export const AUTH_SCOPES = ['openid', 'email', 'profile'];

const OAUTH_NOT_CONFIGURED = {
  error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Google sign-in is not configured on this server' },
};

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function authRoutes(config, passportInstance, oauthEnabled) {
  const router = Router();
  const limiter = createRateLimiter(config.limits.authRateLimit);

  router.get('/auth/google', limiter, (req, res, next) => {
    if (!oauthEnabled) return res.status(503).json(OAUTH_NOT_CONFIGURED);
    req.session.returnTo = safeReturnTo(req.query.returnTo);
    passportInstance.authenticate('google', { scope: AUTH_SCOPES })(req, res, next);
  });

  router.get('/auth/google/callback', limiter, (req, res, next) => {
    if (!oauthEnabled) return res.status(503).json(OAUTH_NOT_CONFIGURED);
    passportInstance.authenticate('google', (err, user) => {
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
    })(req, res, next);
  });

  router.get('/auth/failure', (_req, res) => {
    res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Google sign-in failed or was cancelled' } });
  });

  router.post('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => res.clearCookie('ims13.sid').json({ ok: true }));
    });
  });

  router.get('/auth/status', (req, res) => {
    res.json({
      authenticated: Boolean(req.user),
      user: req.user ? { name: req.user.name, email: req.user.email, role: req.user.role } : null,
    });
  });

  return router;
}
