import { Router } from "express";
import {
  createCompany,
  getMyCompany,
  getPublicCompanyInfo,
  joinCompany,
  inviteMembers,
  getInviteInfo,
  acceptInvite,
  getMembers,
  updateMemberStatus,
  updateCompany,
  uploadCompanyLogo,
  leaveCompany,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from "../controllers/company.controller";
import { authenticate } from "../middleware/auth.middleware";
import { upload } from "../middleware/upload.middleware";

const router = Router();

// Todas as rotas de empresa requerem autenticação
router.post("/", authenticate, createCompany);
router.get("/me", authenticate, getMyCompany);
router.patch("/me", authenticate, updateCompany);
router.post("/me/workspaces", authenticate, createWorkspace);
router.patch("/me/workspaces/:workspaceId", authenticate, updateWorkspace);
router.delete("/me/workspaces/:workspaceId", authenticate, deleteWorkspace);
router.post(
  "/me/logo",
  authenticate,
  upload.single("logo"),
  uploadCompanyLogo
);

// Convites por e-mail
router.post("/me/invites", authenticate, inviteMembers);
router.get("/invites/:token", getInviteInfo);
router.post("/invites/:token/accept", authenticate, acceptInvite);

// Convites por link / Ver empresa publicamente
router.get("/:id/public", getPublicCompanyInfo);
router.post("/:id/join", authenticate, joinCompany);

// Gestão de Membros
router.get("/:id/members", authenticate, getMembers);
router.patch("/:id/members/:memberId", authenticate, updateMemberStatus);

// Sair da empresa
router.post("/me/leave", authenticate, leaveCompany);

export default router;
