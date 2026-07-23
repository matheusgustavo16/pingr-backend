import { Router } from "express";
import {
  listTranscripts,
  listCallSessions,
  listMyCallSessions,
  getMyCallSessionStats,
  listMyMeetingSummaries,
} from "../controllers/transcript.controller";
import { listAgentActions } from "../controllers/agent.controller";
import {
  getCallSessionSummary,
  generateCallSessionSummary,
  mergeCallSessionSummaries,
} from "../controllers/meeting-summary.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Rotas estáticas antes de /:roomId para não capturar "me" como id
router.get("/me/call-sessions/stats", authenticate, getMyCallSessionStats);
router.get("/me/call-sessions", authenticate, listMyCallSessions);
router.get("/me/meeting-summaries", authenticate, listMyMeetingSummaries);

router.get("/:roomId/transcripts", authenticate, listTranscripts);
router.get("/:roomId/call-sessions", authenticate, listCallSessions);
router.post("/:roomId/call-sessions/merge-summaries", authenticate, mergeCallSessionSummaries);
router.get("/:roomId/call-sessions/:callSessionId/summary", authenticate, getCallSessionSummary);
router.post("/:roomId/call-sessions/:callSessionId/summary/generate", authenticate, generateCallSessionSummary);
router.get("/:roomId/agent-actions", authenticate, listAgentActions);

export default router;
