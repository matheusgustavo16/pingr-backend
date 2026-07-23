import { Router } from "express";
import {
  login,
  register,
  googleAuthStart,
  googleAuthCallback,
  createGuest,
  getMe,
  updateStatus,
  updateProfile,
  updatePreferences,
  uploadAvatar,
  deleteAccount,
  updatePassword,
  getTwoFactorStatus,
  enableTwoFactor,
  disableTwoFactor,
  getSessions,
  revokeSession,
} from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";
import { upload } from "../middleware/upload.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/google", googleAuthStart);
router.get("/google/callback", googleAuthCallback);
router.post("/guest", createGuest);
router.get("/me", authenticate, getMe);
router.patch("/status", authenticate, updateStatus);
router.patch("/profile", authenticate, updateProfile);
router.patch("/preferences", authenticate, updatePreferences);
router.post(
  "/avatar",
  authenticate,
  upload.single("avatar"),
  uploadAvatar
);
router.delete("/account", authenticate, deleteAccount);

// Password
router.patch("/password", authenticate, updatePassword);

// Two Factor Authentication
router.get("/2fa", authenticate, getTwoFactorStatus);
router.post("/2fa/enable", authenticate, enableTwoFactor);
router.post("/2fa/disable", authenticate, disableTwoFactor);

// Sessions
router.get("/sessions", authenticate, getSessions);
router.delete("/sessions/:sessionId", authenticate, revokeSession);

export default router;
