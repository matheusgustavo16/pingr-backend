import { Router } from "express";
import {
  createDecoration,
  updateDecorationPosition,
  updateDecorationScale,
  deleteDecoration,
} from "../controllers/decoration.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, createDecoration);
router.patch("/:id/position", authenticate, updateDecorationPosition);
router.patch("/:id/scale", authenticate, updateDecorationScale);
router.delete("/:id", authenticate, deleteDecoration);

export default router;
