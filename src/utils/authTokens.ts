interface InternalJwtPayload {
  exp?: number;
  Exp?: number;
  iat?: number;
  Iat?: number;
  creation?: number;
  Creation?: number;
  [k: string]: any;
}

function base64UrlDecode(segment: string): string {
  try {
    let s = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4;
    if (pad) s += "=".repeat(4 - pad);
    if (typeof atob === "function") return atob(s);
    // Fallback minimal polyfill (browser-only target; Node Buffer not available without types)
    // If atob missing (older env), attempt TextDecoder on Uint8Array decode path
    if (typeof window === "undefined") return "";
    // @ts-ignore - TypeScript may not know atob is defined in some envs
    return atob(s);
  } catch {
    return "";
  }
}

export function parseJwt(token: string): InternalJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function computeNextTokenRefresh(token: string): Date {
  const payload = parseJwt(token);
  if (!payload) return new Date();
  const exp = payload.Exp ?? payload.exp;
  const creation =
    payload.Creation ?? payload.creation ?? payload.iat ?? payload.Iat;
  const now = Date.now();
  if (
    typeof exp === "number" &&
    typeof creation === "number" &&
    exp > creation
  ) {
    const lifetimeSec = exp - creation;
    return new Date(now + lifetimeSec * 1000);
  } else if (typeof exp === "number") {
    return new Date(exp * 1000);
  }
  return new Date();
}

/**
 * Distinguishes a genuine authentication failure (401/403 from the backend,
 * meaning the token was rejected / revoked / expired-invalid) from a
 * transient network problem (server unreachable, timeout, offline).
 *
 * We use this to avoid destroying a still-valid session whenever the backend
 * is merely temporarily unreachable. Only genuine auth errors should force
 * the user out to the login screen.
 */
export function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Matches HTTP status codes and common auth-failure wording. Note that a
  // backend refresh can legitimately respond 400 with "Invalid or expired
  // refresh token", so we match the wording too.
  return /\b401\b|\b403\b|Unauthorized|Forbidden|Invalid or expired refresh token/i.test(
    msg,
  );
}
