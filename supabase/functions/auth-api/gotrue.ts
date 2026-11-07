// The few Supabase Auth (GoTrue) endpoints auth-api uses. All documented:
//   admin users  https://supabase.com/docs/reference/javascript/auth-admin-createuser
//   generateLink https://supabase.com/docs/reference/javascript/auth-admin-generatelink
//   password     https://supabase.com/docs/reference/javascript/auth-signinwithpassword
//   verify       https://supabase.com/docs/reference/javascript/auth-verifyotp
//   refresh      https://supabase.com/docs/reference/javascript/auth-refreshsession
//   getUser      https://supabase.com/docs/reference/javascript/auth-getuser
//   signOut      https://supabase.com/docs/reference/javascript/auth-signout

export interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: { id: string; email?: string };
}

export class GoTrueError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
  ) {
    super(`gotrue ${status} ${errorCode}`);
  }
}

export class GoTrue {
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly serviceKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(
    path: string,
    init: { method?: string; body?: unknown; bearer?: string; admin?: boolean },
  ): Promise<T> {
    const key = init.admin ? this.serviceKey : this.anonKey;
    const res = await this.fetchImpl(`${this.url}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${init.bearer ?? key}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new GoTrueError(res.status, String(data.error_code ?? data.error ?? 'unknown'));
    }
    return data as T;
  }

  createUser(input: {
    email: string;
    password?: string;
    emailConfirm: boolean;
    displayName?: string | null;
  }): Promise<{ id: string }> {
    return this.call('/admin/users', {
      admin: true,
      body: {
        email: input.email,
        password: input.password,
        email_confirm: input.emailConfirm,
        user_metadata: input.displayName ? { display_name: input.displayName } : {},
      },
    });
  }

  updateUser(id: string, input: { password?: string; emailConfirm?: boolean; email?: string }) {
    return this.call<{ id: string }>(`/admin/users/${id}`, {
      method: 'PUT',
      admin: true,
      body: {
        ...(input.password !== undefined ? { password: input.password } : {}),
        ...(input.emailConfirm !== undefined ? { email_confirm: input.emailConfirm } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
      },
    });
  }

  deleteUser(id: string) {
    return this.call(`/admin/users/${id}`, { method: 'DELETE', admin: true });
  }

  /** Password grant. Supabase Auth checks the password first, then email confirmation. */
  signInWithPassword(email: string, password: string): Promise<GoTrueSession> {
    return this.call('/token?grant_type=password', { body: { email, password } });
  }

  /**
   * Server-side session for a user auth-api has already authenticated (a code, a ticket or an
   * Apple/Google token). The one-time token never leaves the server and nothing is emailed
   * (generate_link doesn't send, and the Send Email hook drops all Supabase Auth email).
   */
  async mintSession(email: string): Promise<GoTrueSession> {
    const link = await this.call<{ hashed_token?: string; properties?: { hashed_token?: string } }>(
      '/admin/generate_link',
      { admin: true, body: { type: 'magiclink', email } },
    );
    const tokenHash = link.properties?.hashed_token ?? link.hashed_token;
    if (!tokenHash) throw new GoTrueError(500, 'no_hashed_token');
    return this.call('/verify', { body: { type: 'magiclink', token_hash: tokenHash } });
  }

  refresh(refreshToken: string): Promise<GoTrueSession> {
    return this.call('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
  }

  /** Checks the access token's signature AND that its session still exists. */
  getUser(accessToken: string): Promise<{ id: string; email?: string }> {
    return this.call('/user', { method: 'GET', bearer: accessToken });
  }

  signOut(accessToken: string, scope: 'local' | 'global' | 'others') {
    return this.call(`/logout?scope=${scope}`, { bearer: accessToken });
  }
}
