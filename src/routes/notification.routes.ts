import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  clearAllNotifications,
} from "../controllers/notification.controller";

const router = Router();

router.get("/", authenticate, listNotifications);
router.patch("/read-all", authenticate, markAllNotificationsRead);
router.patch("/:id/read", authenticate, markNotificationRead);
router.delete("/:id", authenticate, dismissNotification);
router.delete("/", authenticate, clearAllNotifications);

export default router;
