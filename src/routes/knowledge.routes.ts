import { Router } from "express";
import { searchKnowledgeBase } from "../controllers/knowledge.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/search", authenticate, searchKnowledgeBase);

export default router;
