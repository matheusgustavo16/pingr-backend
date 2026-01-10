import { Router } from "express";
import { createRoom, deleteRoom } from "../controllers/room.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, createRoom);
router.delete("/:id", authenticate, deleteRoom);

export default router;
