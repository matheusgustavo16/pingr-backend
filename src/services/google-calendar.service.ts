import "dotenv/config";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
// Suportar o typo comum "GOOGLE_CLIENTE_SECRET" além do correto
const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENTE_SECRET;

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
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

export interface GoogleCalendarListItem {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItem[];
}

export class GoogleCalendarService {
  static getAuthorizationUrl(state?: string): string {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error("Credenciais do Google não configuradas");
    }

    const redirectUri = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/api/integrations/google/callback`;

    // Escopos: perfil para obter userinfo + calendário somente leitura
    const scope = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.readonly",
    ].join(" ");

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      include_granted_scopes: "true",
      access_type: "offline",
      prompt: "consent",
      ...(state ? { state } : {}),
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  static async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    scope?: string;
    tokenType?: string;
    expiryDate?: number;
    idToken?: string;
  }> {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error("Credenciais do Google não configuradas");
    }

    const redirectUri = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/api/integrations/google/callback`;

    const body = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
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

    if (data.error) {
      throw new Error(
        `Erro do Google: ${data.error}${
          data.error_description ? ` - ${data.error_description}` : ""
        }`
      );
    }

    if (!response.ok) {
      throw new Error(`Erro ao trocar código por token: ${JSON.stringify(data)}`);
    }

    if (!data.access_token) {
      throw new Error("Token de acesso não recebido do Google");
    }

    const expiryDate =
      typeof data.expires_in === "number"
        ? Date.now() + data.expires_in * 1000
        : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope,
      tokenType: data.token_type,
      expiryDate,
      idToken: data.id_token,
    };
  }

  static async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    scope?: string;
    tokenType?: string;
    expiryDate?: number;
    idToken?: string;
  }> {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error("Credenciais do Google não configuradas");
    }

    const body = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
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

    if (data.error) {
      throw new Error(
        `Erro ao renovar token: ${data.error}${
          data.error_description ? ` - ${data.error_description}` : ""
        }`
      );
    }

    if (!response.ok) {
      throw new Error(`Erro ao renovar token: ${JSON.stringify(data)}`);
    }

    if (!data.access_token) {
      throw new Error("Access token não recebido ao renovar");
    }

    const expiryDate =
      typeof data.expires_in === "number"
        ? Date.now() + data.expires_in * 1000
        : undefined;

    return {
      accessToken: data.access_token,
      scope: data.scope,
      tokenType: data.token_type,
      expiryDate,
      idToken: data.id_token,
    };
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

  static async listCalendars(accessToken: string): Promise<GoogleCalendarListItem[]> {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao listar calendários: ${errorText}`);
    }

    const data: GoogleCalendarListResponse = await response.json();
    return data.items || [];
  }

  static async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

