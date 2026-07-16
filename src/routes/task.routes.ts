import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { uploadAny } from "../middleware/upload.middleware";
import {
  addAssignee,
  addWatcher,
  bulkAction,
  createTask,
  deleteTask,
  getTask,
  getTaskActivity,
  listTasks,
  moveTask,
  removeAssignee,
  removeWatcher,
  updateTask,
} from "../controllers/task.controller";
import {
  createChecklist,
  createChecklistItem,
  deleteChecklist,
  deleteChecklistItem,
  updateChecklist,
  updateChecklistItem,
} from "../controllers/task-checklist.controller";
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from "../controllers/task-comment.controller";
import { createAttachment, deleteAttachment } from "../controllers/task-attachment.controller";

const router = Router();

router.use(authenticate);

// Tasks
router.get("/", listTasks);
router.post("/", createTask);
router.post("/bulk", bulkAction);
router.get("/:id", getTask);
router.patch("/:id", updateTask);
router.patch("/:id/move", moveTask);
router.delete("/:id", deleteTask);
router.get("/:id/activity", getTaskActivity);

// Assignees
router.post("/:id/assignees", addAssignee);
router.delete("/:id/assignees/:userId", removeAssignee);

// Watchers
router.post("/:id/watchers", addWatcher);
router.delete("/:id/watchers/:userId", removeWatcher);

// Checklists
router.post("/:id/checklists", createChecklist);
router.patch("/checklists/:id", updateChecklist);
router.delete("/checklists/:id", deleteChecklist);
router.post("/checklists/:id/items", createChecklistItem);
router.patch("/checklist-items/:id", updateChecklistItem);
router.delete("/checklist-items/:id", deleteChecklistItem);

// Comments
router.get("/:id/comments", listComments);
router.post("/:id/comments", createComment);
router.patch("/comments/:id", updateComment);
router.delete("/comments/:id", deleteComment);

// Attachments
router.post("/:id/attachments", uploadAny.single("file"), createAttachment);
router.delete("/attachments/:id", deleteAttachment);

export default router;
