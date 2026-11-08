// Web only: /api/supabase/* → the Data API (and food-lookup) with the cookie's access token.
import { bffFromEnv } from '@/server/bff';

const handle = (req: Request, { path }: { path?: string[] | string }) =>
  bffFromEnv(req).supabase(req, `/${(Array.isArray(path) ? path : [path ?? '']).join('/')}`);

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
