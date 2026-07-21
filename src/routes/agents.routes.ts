import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  listAgents,
  listAgentTemplates,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
} from "../controllers/agent-management.controller";

const router = Router();

router.get("/templates", authenticate, listAgentTemplates);
router.get("/:agentId", authenticate, getAgent);
router.get("/", authenticate, listAgents);
router.post("/", authenticate, createAgent);
router.patch("/:agentId", authenticate, updateAgent);
router.delete("/:agentId", authenticate, deleteAgent);

export default router;
