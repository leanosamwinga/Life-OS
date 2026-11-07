// Web only: /api/auth/* → auth-api, with the session in httpOnly cookies (src/server/bff.ts).
import { bffFromEnv } from '@/server/bff';

const handle = (req: Request, { path }: { path?: string[] | string }) =>
  bffFromEnv(req).auth(req, `/${(Array.isArray(path) ? path : [path ?? '']).join('/')}`);

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
