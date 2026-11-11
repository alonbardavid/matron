/**
 * Every public procedure of the application is under this path. The router
 * lets a signed-out request for it through to main's application; everything
 * else under /api/app/* needs a signed-in member.
 */
export const PUBLIC_APP_PATH = "/api/app/public";
