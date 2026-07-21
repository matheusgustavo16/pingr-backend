import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  listConversations,
  createConversation,
  getConversation,
  updateConversation,
  deleteConversation,
  queryConversation,
} from "../controllers/agent-conversation.controller";

const router = Router();

router.get("/", authenticate, listConversations);
router.post("/", authenticate, createConversation);
router.get("/:id", authenticate, getConversation);
router.patch("/:id", authenticate, updateConversation);
router.delete("/:id", authenticate, deleteConversation);
router.post("/:id/query", authenticate, queryConversation);

export default router;
