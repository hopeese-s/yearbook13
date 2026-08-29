/** Gate: any signed-in user. */
export function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } });
}

/** Gate: signed-in admins only (ADMIN_EMAILS allowlist decides the role). */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
}
