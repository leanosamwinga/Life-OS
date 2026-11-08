/** The one-time re-auth token (5 minutes, this session only) from S-5b/5c for S-5e. Memory only. */
let token: string | null = null;
export const reauth = {
  set(t: string) {
    token = t;
  },
  take(): string | null {
    const t = token;
    token = null;
    return t;
  },
};
