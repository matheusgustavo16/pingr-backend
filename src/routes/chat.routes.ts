import { Router } from "express";
import {
  listMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  updateReadState,
  getChannel,
  getChannelByRoom,
  pinMessage,
  getSystemAgentBot,
  getUnreadCounts,
  getLinkPreview,
  uploadChatAttachment,
} from "../controllers/chat.controller";
import { authenticate } from "../middleware/auth.middleware";
import { uploadAny } from "../middleware/upload.middleware";

const router = Router();

// Rotas de mensagens
router.post("/messages", authenticate, sendMessage);
router.post(
  "/channels/:channelId/attachments",
  authenticate,
  uploadAny.single("file"),
  uploadChatAttachment
);
router.put("/messages/:messageId", authenticate, editMessage);
router.delete("/messages/:messageId", authenticate, deleteMessage);
router.patch("/messages/:messageId/pin", authenticate, pinMessage);

// Rotas de canais
router.get("/channels/:channelId", authenticate, getChannel);
router.get("/channels/:channelId/messages", authenticate, listMessages);
router.put("/channels/:channelId/read", authenticate, updateReadState);

// Rotas de salas (para obter canal por roomId)
router.get("/rooms/:roomId/channel", authenticate, getChannelByRoom);

// Contagem de não lidas por canal (sidebar)
router.get("/companies/:companyId/unread-counts", authenticate, getUnreadCounts);

// Preview de link (Open Graph), com cache
router.post("/link-preview", authenticate, getLinkPreview);

// Rotas de bots
router.get("/bots/pingr", authenticate, getSystemAgentBot);

export default router;
