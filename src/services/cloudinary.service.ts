import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
}

/**
 * Faz upload de uma imagem para o Cloudinary
 * @param fileBuffer Buffer do arquivo
 * @param folder Pasta onde será armazenado (ex: "avatars", "company-logos")
 * @param userId ID do usuário para organização
 * @returns URL da imagem e informações do upload
 */
export async function uploadImage(
  fileBuffer: Buffer,
  folder: string = "uploads",
  userId?: string
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: userId ? `${folder}/${userId}` : folder,
        resource_type: "image",
        transformation: [
          {
            width: 512,
            height: 512,
            crop: "limit",
            quality: "auto",
            fetch_format: "auto",
          },
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width || 0,
            height: result.height || 0,
          });
        } else {
          reject(new Error("Upload failed: no result"));
        }
      }
    );

    // Converter buffer para stream
    const stream = Readable.from(fileBuffer);
    stream.pipe(uploadStream);
  });
}

/**
 * Deleta uma imagem do Cloudinary
 * @param publicId Public ID da imagem no Cloudinary
 */
export async function deleteImage(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Erro ao deletar imagem do Cloudinary:", error);
    throw error;
  }
}

/**
 * Extrai o public ID de uma URL do Cloudinary
 */
export function extractPublicIdFromUrl(url: string): string | null {
  try {
    const match = url.match(/\/v\d+\/(.+)\.(jpg|jpeg|png|gif|webp)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export interface UploadFileResult {
  url: string;
  publicId: string;
  fileType: string;
  fileSize: number;
}

function resourceTypeForMime(mimeType?: string): "image" | "video" | "raw" {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/") || mimeType?.startsWith("audio/")) return "video";
  return "raw";
}

/**
 * Faz upload de um arquivo qualquer (anexo de task, documento, etc) para o Cloudinary,
 * sem transformação/resize.
 *
 * Usa `resource_type` explícito (via `mimeType`) em vez de "auto": o Cloudinary trata
 * PDF como resource_type "image" sob "auto" (pra poder renderizar páginas como imagem),
 * e contas novas bloqueiam por padrão a entrega de PDF/ZIP nesse tipo por segurança —
 * a URL retornada existe mas responde 401 com um GIF vazio no lugar do arquivo.
 * Forçar "raw" pra qualquer coisa que não seja imagem/vídeo/áudio evita essa entrega bloqueada.
 * @param fileBuffer Buffer do arquivo
 * @param folder Pasta onde será armazenado (ex: "task-attachments")
 * @param fileName Nome original do arquivo, usado para preservar a extensão
 * @param mimeType Mimetype do arquivo, usado para decidir o resource_type correto
 */
export async function uploadFile(
  fileBuffer: Buffer,
  folder: string = "uploads",
  fileName?: string,
  mimeType?: string
): Promise<UploadFileResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: mimeType ? resourceTypeForMime(mimeType) : "auto",
        use_filename: Boolean(fileName),
        unique_filename: true,
        filename_override: fileName,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            fileType: result.resource_type || "raw",
            fileSize: result.bytes || fileBuffer.length,
          });
        } else {
          reject(new Error("Upload failed: no result"));
        }
      }
    );

    const stream = Readable.from(fileBuffer);
    stream.pipe(uploadStream);
  });
}

/**
 * Deleta um arquivo genérico do Cloudinary. Como resource_type não é persistido
 * junto ao anexo, tenta nos tipos possíveis até conseguir remover.
 */
export async function deleteFile(publicId: string, mimeType?: string): Promise<void> {
  const preferredType = resourceTypeForMime(mimeType);
  const typesToTry = Array.from(
    new Set([preferredType, "raw", "image", "video"] as const)
  );

  for (const resource_type of typesToTry) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type });
      if (result?.result === "ok") {
        return;
      }
    } catch (error) {
      console.error(`Erro ao deletar arquivo do Cloudinary (${resource_type}):`, error);
    }
  }
}
