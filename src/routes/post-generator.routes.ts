import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { uploadAny } from "../middleware/upload.middleware";
import {
  listTemplates,
  uploadTemplate,
  deleteTemplate,
  listGenerations,
  getGeneration,
  composeGeneration,
  createGeneration,
  deleteGeneration,
} from "../controllers/post-generator.controller";

const router = Router();

router.use(authenticate);

router.get("/templates", listTemplates);
router.post("/templates", uploadAny.single("file"), uploadTemplate);
router.delete("/templates/:id", deleteTemplate);

router.get("/generations", listGenerations);
router.post("/generations/compose", composeGeneration);
router.post("/generations", createGeneration);
router.get("/generations/:id", getGeneration);
router.delete("/generations/:id", deleteGeneration);

export default router;
