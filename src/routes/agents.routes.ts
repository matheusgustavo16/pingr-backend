import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { upload } from "../middleware/upload.middleware";
import {
  listAgents,
  listAgentTemplates,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  uploadAgentAvatar,
} from "../controllers/agent-management.controller";

const router = Router();

router.get("/templates", authenticate, listAgentTemplates);
router.post("/avatar", authenticate, upload.single("avatar"), uploadAgentAvatar);
router.get("/:agentId", authenticate, getAgent);
router.get("/", authenticate, listAgents);
router.post("/", authenticate, createAgent);
router.patch("/:agentId", authenticate, updateAgent);
router.delete("/:agentId", authenticate, deleteAgent);

export default router;
