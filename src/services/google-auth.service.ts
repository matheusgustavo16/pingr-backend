import "dotenv/config";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
// Suportar o typo comum "GOOGLE_CLIENTE_SECRET" além do correto
const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENTE_SECRET;

function getRedirectUri(): string {
  return `${process.env.FRONTEND_URL || "http://localhost:3000"}/api/auth/google/callback`;
}

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export class GoogleAuthService {
  static getAuthorizationUrl(state?: string): string {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error("Credenciais do Google não configuradas");
    }

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: getRedirectUri(),
      response_type: "code",
      scope: ["openid", "email", "profile"].join(" "),
      prompt: "select_account",
      ...(state ? { state } : {}),
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  static async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; idToken?: string }> {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error("Credenciais do Google não configuradas");
    }

    const body = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const data: GoogleTokenResponse = await response.json();

    if (data.error || !response.ok) {
      throw new Error(
        `Erro ao trocar código por token: ${data.error || response.statusText}${
          data.error_description ? ` - ${data.error_description}` : ""
        }`
      );
    }

    if (!data.access_token) {
      throw new Error("Token de acesso não recebido do Google");
    }

    return { accessToken: data.access_token, idToken: data.id_token };
  }

  static async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao obter userinfo do Google: ${errorText}`);
    }

    return response.json();
  }
}
