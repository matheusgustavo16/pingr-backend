import "dotenv/config";

// App OAuth separado do usado pela integração de repositórios (GITHUB_CLIENT_ID/SECRET):
// GitHub OAuth Apps só aceitam UMA "Authorization callback URL" cadastrada, então login
// (escopo mínimo, callback próprio) precisa do seu próprio Client ID/Secret.
const GITHUB_CLIENT_ID = process.env.GITHUB_LOGIN_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_LOGIN_CLIENT_SECRET;

function getRedirectUri(): string {
  return `${process.env.FRONTEND_URL || "http://localhost:3000"}/api/auth/github/callback`;
}

export interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GitHubUserInfo {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export class GitHubAuthService {
  static getAuthorizationUrl(state?: string): string {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      throw new Error("Credenciais de login do GitHub não configuradas");
    }

    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: getRedirectUri(),
      scope: "read:user user:email",
      ...(state ? { state } : {}),
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(code: string): Promise<string> {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      throw new Error("Credenciais de login do GitHub não configuradas");
    }

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: getRedirectUri(),
      }),
    });

    const data: GitHubTokenResponse = await response.json();

    if (data.error || !response.ok) {
      throw new Error(
        `Erro ao trocar código por token: ${data.error || response.statusText}${
          data.error_description ? ` - ${data.error_description}` : ""
        }`
      );
    }

    if (!data.access_token) {
      throw new Error("Token de acesso não recebido do GitHub");
    }

    return data.access_token;
  }

  static async getUserInfo(accessToken: string): Promise<GitHubUserInfo> {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Pingr-App",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao obter informações do usuário: ${errorText}`);
    }

    const user: GitHubUserInfo = await response.json();

    if (!user.email) {
      user.email = await this.getPrimaryEmail(accessToken);
    }

    return user;
  }

  private static async getPrimaryEmail(accessToken: string): Promise<string | null> {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Pingr-App",
      },
    });

    if (!response.ok) return null;

    const emails: GitHubEmail[] = await response.json();
    const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
    return primary?.email || null;
  }
}
