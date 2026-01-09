import { Router } from "express";
import { createCompany, getMyCompany } from "../controllers/company.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Todas as rotas de empresa requerem autenticação
router.post("/", authenticate, createCompany);
router.get("/me", authenticate, getMyCompany);

export default router;

