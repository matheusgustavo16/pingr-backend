import { Router } from "express";
import {
  listTranscripts,
  listCallSessions,
  listMyCallSessions,
} from "../controllers/transcript.controller";
import { listAgentActions } from "../controllers/agent.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Rotas estáticas antes de /:roomId para não capturar "me" como id
router.get("/me/call-sessions", authenticate, listMyCallSessions);

router.get("/:roomId/transcripts", authenticate, listTranscripts);
router.get("/:roomId/call-sessions", authenticate, listCallSessions);
router.get("/:roomId/agent-actions", authenticate, listAgentActions);

export default router;
