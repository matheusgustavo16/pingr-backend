import { Router } from "express";
import {
  initiateGitHubOAuth,
  handleGitHubCallback,
  listGitHubRepositories,
  getGitHubIntegrationStatus,
  getGitHubWorkspaceSprint,
  disconnectGitHub,
  initiateGoogleOAuth,
  handleGoogleCallback,
  listGoogleCalendars,
  getGoogleIntegrationStatus,
  disconnectGoogle,
} from "../controllers/integration.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Rotas de integração do GitHub
router.get("/github/oauth", authenticate, initiateGitHubOAuth);
router.get("/github/callback", handleGitHubCallback);
router.get("/github/repositories", authenticate, listGitHubRepositories);
router.get("/github/status", authenticate, getGitHubIntegrationStatus);
router.get("/github/workspaces/:workspaceId/sprint", authenticate, getGitHubWorkspaceSprint);
router.delete("/github", authenticate, disconnectGitHub);

// Rotas de integração do Google Calendar
router.get("/google/oauth", authenticate, initiateGoogleOAuth);
router.get("/google/callback", handleGoogleCallback);
router.get("/google/calendars", authenticate, listGoogleCalendars);
router.get("/google/status", authenticate, getGoogleIntegrationStatus);
router.delete("/google", authenticate, disconnectGoogle);

export default router;
