import { Router } from "express";
import {
  createRoom,
  deleteRoom,
  getRoomPublicInfo,
  reorderRooms,
  updateRoomPosition,
} from "../controllers/room.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, createRoom);
router.patch("/reorder", authenticate, reorderRooms);
router.delete("/:id", authenticate, deleteRoom);
router.patch("/:id/position", authenticate, updateRoomPosition);
// Sem authenticate: precisa funcionar para visitante ainda não logado
router.get("/:id/public", getRoomPublicInfo);

export default router;
