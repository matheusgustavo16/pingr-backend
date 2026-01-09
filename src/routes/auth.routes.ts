import { Router } from "express";
import { login, register, getMe, verifyTwoFactor } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-two-factor", verifyTwoFactor);
router.get("/me", authenticate, getMe);

export default router;
