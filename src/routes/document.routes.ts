import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { uploadAny } from "../middleware/upload.middleware";
import { createFolder, deleteFolder, listFolderContents, listFolderTree, updateFolder } from "../controllers/folder.controller";
import { deleteDocument, updateDocument, uploadDocument } from "../controllers/document.controller";

const router = Router();

router.use(authenticate);

router.get("/", listFolderContents);
router.get("/tree", listFolderTree);

router.post("/folders", createFolder);
router.patch("/folders/:id", updateFolder);
router.delete("/folders/:id", deleteFolder);

router.post("/upload", uploadAny.single("file"), uploadDocument);
router.patch("/:id", updateDocument);
router.delete("/:id", deleteDocument);

export default router;
