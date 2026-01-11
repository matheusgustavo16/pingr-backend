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
} from "../controllers/chat.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Rotas de mensagens
router.post("/messages", authenticate, sendMessage);
router.put("/messages/:messageId", authenticate, editMessage);
router.delete("/messages/:messageId", authenticate, deleteMessage);
router.patch("/messages/:messageId/pin", authenticate, pinMessage);

// Rotas de canais
router.get("/channels/:channelId", authenticate, getChannel);
router.get("/channels/:channelId/messages", authenticate, listMessages);
router.put("/channels/:channelId/read", authenticate, updateReadState);

// Rotas de salas (para obter canal por roomId)
router.get("/rooms/:roomId/channel", authenticate, getChannelByRoom);

export default router;
