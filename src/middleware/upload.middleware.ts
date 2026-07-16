import multer from "multer";
import { Request } from "express";

// Configurar multer para armazenar em memória
const storage = multer.memoryStorage();

// Filtro para aceitar apenas imagens
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Aceitar apenas imagens
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Apenas arquivos de imagem são permitidos"));
  }
};

// Configurar multer
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
  },
});

// Multer para anexos genéricos (ex: task attachments) — sem restrição de mimetype
export const uploadAny = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
});
