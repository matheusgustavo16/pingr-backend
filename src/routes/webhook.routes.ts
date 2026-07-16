import { Router } from "express";
import { handleGitHubWebhook } from "../controllers/webhook.controller";

const router = Router();

// Webhook do GitHub (não requer autenticação, usa assinatura)
router.post("/github", handleGitHubWebhook);

export default router;
