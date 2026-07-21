import { Router } from "express";
import {
  createScheduleEvent,
  listScheduleEventsByCompany,
  linkRoomToScheduleEvent,
  getScheduleEventByRoom,
  updateScheduleEvent,
  deleteScheduleEvent,
  updateEventOccurrence,
} from "../controllers/schedule.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Criar evento
router.post("/", authenticate, createScheduleEvent);

// Listar eventos de uma empresa por range de datas
router.get("/company/:companyId", authenticate, listScheduleEventsByCompany);

// Editar a série inteira de um evento
router.patch("/:eventId", authenticate, updateScheduleEvent);

// Excluir a série inteira de um evento
router.delete("/:eventId", authenticate, deleteScheduleEvent);

// Editar ou cancelar só uma ocorrência de uma série recorrente
router.patch("/:eventId/occurrence", authenticate, updateEventOccurrence);

// Vincular sala a um evento
router.patch("/:eventId/room", authenticate, linkRoomToScheduleEvent);

// Buscar evento pela sala
router.get("/room/:roomId", authenticate, getScheduleEventByRoom);

export default router;
