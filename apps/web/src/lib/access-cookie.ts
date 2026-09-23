/**
 * Just the cookie name, with no `server-only` or `next/headers` import, so
 * both the Edge middleware (which can't use next/headers) and
 * lib/server/access.ts (which can) share the exact same constant.
 */
export const ACCESS_COOKIE_NAME = "ccg_access";
