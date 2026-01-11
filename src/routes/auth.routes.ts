import { Router } from "express";
import { login, register, getMe, updateStatus } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", authenticate, getMe);
router.patch("/status", authenticate, updateStatus);

export default router;
