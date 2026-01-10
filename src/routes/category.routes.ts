import { Router } from "express";
import {
  createCategory,
  deleteCategory,
} from "../controllers/category.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, createCategory);
router.delete("/:id", authenticate, deleteCategory);

export default router;
