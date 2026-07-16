import "dotenv/config";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  console.warn(
    "⚠️  GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET não configurados."
  );
}

export interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string;
  email: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  default_branch: string;
}

export interface GitHubMilestone {
  number: number;
  title: string;
  description: string | null;
  state: "open" | "closed";
  open_issues: number;
  closed_issues: number;
  created_at: string;
  due_on: string | null;
  html_url: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  assignee: { login: string; avatar_url: string } | null;
}

export class GitHubService {
  /**
   * Gera a URL de autorização OAuth do GitHub
   */
  static getAuthorizationUrl(state?: string): string {
    const redirectUri = `${process.env.FRONTEND_URL || "http://localhost:3000"}/api/integrations/github/callback`;
    const scope = "repo user:email";
    const clientId = GITHUB_CLIENT_ID;

    if (!clientId) {
      throw new Error("GITHUB_CLIENT_ID não configurado");
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      ...(state && { state }),
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Troca o código de autorização por um token de acesso
   */
  static async exchangeCodeForToken(code: string): Promise<string> {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      throw new Error("Credenciais do GitHub não configuradas");
    }

    const redirectUri = `${process.env.FRONTEND_URL || "http://localhost:3000"}/api/integrations/github/callback`;

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
        redirect_uri: redirectUri,
      }),
    });

    const data: GitHubTokenResponse = await response.json();

    // Verificar se há erro na resposta (mesmo com status 200, GitHub pode retornar erro)
    if (data.error) {
      throw new Error(
        `Erro do GitHub: ${data.error}${data.error_description ? ` - ${data.error_description}` : ""}`
      );
    }

    if (!data.access_token) {
      throw new Error("Token de acesso não recebido do GitHub");
    }

    if (!response.ok) {
      const errorText = JSON.stringify(data);
      throw new Error(`Erro ao trocar código por token: ${errorText}`);
    }

    return data.access_token;
  }

  /**
   * Obtém informações do usuário autenticado
   */
  static async getUserInfo(accessToken: string): Promise<GitHubUser> {
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

    return response.json();
  }

  /**
   * Lista os repositórios do usuário autenticado
   */
  static async listRepositories(
    accessToken: string,
    options?: {
      type?: "all" | "owner" | "member";
      sort?: "created" | "updated" | "pushed" | "full_name";
      direction?: "asc" | "desc";
      per_page?: number;
      page?: number;
    }
  ): Promise<GitHubRepository[]> {
    const {
      type = "all",
      sort = "updated",
      direction = "desc",
      per_page = 30,
      page = 1,
    } = options || {};

    const params = new URLSearchParams({
      type,
      sort,
      direction,
      per_page: per_page.toString(),
      page: page.toString(),
    });

    const response = await fetch(
      `https://api.github.com/user/repos?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Pingr-App",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao listar repositórios: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Lista milestones de um repositório
   */
  static async listMilestones(
    accessToken: string,
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "open"
  ): Promise<GitHubMilestone[]> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/milestones?state=${state}&sort=due_on&direction=asc`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Pingr-App",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao listar milestones: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Lista as issues (excluindo pull requests) de um milestone
   */
  static async listIssuesForMilestone(
    accessToken: string,
    owner: string,
    repo: string,
    milestoneNumber: number
  ): Promise<GitHubIssue[]> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?milestone=${milestoneNumber}&state=all&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Pingr-App",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao listar issues do milestone: ${errorText}`);
    }

    const data: any[] = await response.json();
    // A API de issues do GitHub também retorna PRs; filtrar apenas issues de fato
    return data.filter((item) => !item.pull_request);
  }

  /**
   * Verifica se um token é válido
   */
  static async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Pingr-App",
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Cria um webhook no repositório GitHub
   */
  static async createRepositoryWebhook(
    accessToken: string,
    owner: string,
    repo: string,
    webhookUrl: string,
    secret?: string
  ): Promise<{ id: number; url: string }> {
    const [repoOwner, repoName] = repo.includes("/") 
      ? repo.split("/") 
      : [owner, repo];

    const response = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/hooks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Pingr-App",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: [
            "push",
            "pull_request",
            "issues",
            "issue_comment",
            "release",
            "create",
            "delete",
          ],
          config: {
            url: webhookUrl,
            content_type: "json",
            insecure_ssl: "0",
            ...(secret && { secret }),
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao criar webhook: ${errorText}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      url: data.url,
    };
  }

  /**
   * Deleta um webhook do repositório GitHub
   */
  static async deleteRepositoryWebhook(
    accessToken: string,
    owner: string,
    repo: string,
    hookId: number
  ): Promise<void> {
    const [repoOwner, repoName] = repo.includes("/") 
      ? repo.split("/") 
      : [owner, repo];

    const response = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/hooks/${hookId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Pingr-App",
        },
      }
    );

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(`Erro ao deletar webhook: ${errorText}`);
    }
  }
}
