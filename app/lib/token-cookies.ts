/**
 * The cookies that carry the Convex Auth tokens.
 *
 * Written by `/api/auth-token` (the `HttpOnly` store the browser talks to) and
 * read by the owner resolver in `owner.server.ts`, which needs the same names
 * and the same lifetime — so they live here rather than being spelled out twice.
 */
export const JWT_COOKIE = "jv_jwt";
export const REFRESH_COOKIE = "jv_refresh";
export const VERIFIER_COOKIE = "jv_verifier";
export const FETCH_TIME_COOKIE = "jv_fetched";
export const MISC_COOKIE = "jv_misc";

/**
 * 30 days. Deliberately longer than the JWT's own lifetime (Convex Auth issues
 * hour-long JWTs): the cookie is the *store*, and what is inside it is what
 * decides whether a request is signed in.
 */
export const TOKEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
