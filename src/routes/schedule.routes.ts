import { Router } from "express";
import {
  createScheduleEvent,
  listScheduleEventsByCompany,
  linkRoomToScheduleEvent,
  getScheduleEventByRoom,
} from "../controllers/schedule.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Criar evento
router.post("/", authenticate, createScheduleEvent);

// Listar eventos de uma empresa por range de datas
router.get("/company/:companyId", authenticate, listScheduleEventsByCompany);

// Vincular sala a um evento
router.patch("/:eventId/room", authenticate, linkRoomToScheduleEvent);

// Buscar evento pela sala
router.get("/room/:roomId", authenticate, getScheduleEventByRoom);

export default router;
