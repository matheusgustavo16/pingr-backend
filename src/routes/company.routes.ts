import { Router } from "express";
import {
  createCompany,
  getMyCompany,
  getPublicCompanyInfo,
  joinCompany,
  getMembers,
  updateMemberStatus,
} from "../controllers/company.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Todas as rotas de empresa requerem autenticação
router.post("/", authenticate, createCompany);
router.get("/me", authenticate, getMyCompany);

// Convites / Ver empresa publicamente
router.get("/:id/public", getPublicCompanyInfo);
router.post("/:id/join", authenticate, joinCompany);

// Gestão de Membros
router.get("/:id/members", authenticate, getMembers);
router.patch("/:id/members/:memberId", authenticate, updateMemberStatus);

export default router;
