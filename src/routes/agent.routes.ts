import { Router } from "express";
import { queryAgent } from "../controllers/agent.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/query", authenticate, queryAgent);

export default router;
