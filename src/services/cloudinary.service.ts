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

export function resourceTypeForMime(mimeType?: string): "image" | "video" | "raw" {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/") || mimeType?.startsWith("audio/")) return "video";
  return "raw";
}

/** Extensão do arquivo (sem ponto), a partir do nome original — usada como
 *  `format` na Admin API de download. Cai pra "bin" se não achar extensão. */
function extensionFromFileName(fileName?: string): string {
  const match = fileName?.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "bin";
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
  const resourceType = mimeType ? resourceTypeForMime(mimeType) : "auto";
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        // Cloudinary bloqueia entrega pública do arquivo original pra
        // contas novas/não verificadas (401 "deny or ACL failure" /
        // "show_original_customer_untrusted"), então todo arquivo "raw"
        // (PDF, docx, zip etc — não imagem/vídeo) sobe como "private" e é
        // servido via URL assinada da Admin API (getSignedDeliveryUrl abaixo).
        ...(resourceType === "raw" ? { type: "private" as const } : {}),
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
 * Sobe uma imagem pro Cloudinary a partir de uma URL remota (ex: output do
 * Replicate) — o Cloudinary busca o conteúdo direto, sem precisar baixar o
 * buffer manualmente no processo Node.
 */
export async function uploadImageFromUrl(sourceUrl: string, folder: string): Promise<UploadFileResult> {
  const result = await cloudinary.uploader.upload(sourceUrl, {
    folder,
    resource_type: "image",
  });
  return {
    url: result.secure_url,
    publicId: result.public_id,
    fileType: result.resource_type || "image",
    fileSize: result.bytes || 0,
  };
}

/**
 * Deleta um arquivo genérico do Cloudinary. Como resource_type não é persistido
 * junto ao anexo, tenta nos tipos possíveis até conseguir remover. Recursos
 * "raw" sobem como delivery type "private" (ver uploadFile) — sem o `type`
 * certo o destroy não acha o recurso, por isso cada resource_type tenta
 * também as variações de `type`.
 */
export async function deleteFile(publicId: string, mimeType?: string): Promise<void> {
  const preferredType = resourceTypeForMime(mimeType);
  const resourceTypesToTry = Array.from(
    new Set([preferredType, "raw", "image", "video"] as const)
  );

  for (const resource_type of resourceTypesToTry) {
    const deliveryTypesToTry = resource_type === "raw" ? (["private", "upload"] as const) : (["upload"] as const);
    for (const type of deliveryTypesToTry) {
      try {
        const result = await cloudinary.uploader.destroy(publicId, { resource_type, type });
        if (result?.result === "ok") {
          return;
        }
      } catch (error) {
        console.error(`Erro ao deletar arquivo do Cloudinary (${resource_type}/${type}):`, error);
      }
    }
  }
}

/**
 * Migra um recurso "raw" já enviado como delivery type "upload" (público,
 * hoje bloqueado) pro tipo "private" — usado pelo script de migração
 * (scripts/migrate-raw-to-private.ts) pra destravar arquivos enviados antes
 * do fix. Idempotente: se já estiver "private" (ou não existir mais no
 * Cloudinary), retorna o status em vez de derrubar o batch inteiro.
 */
export async function migrateRawResourceToPrivate(
  publicId: string
): Promise<{ status: "migrated" | "already-private" | "not-found" | "error"; detail?: string }> {
  try {
    await cloudinary.uploader.rename(publicId, publicId, {
      resource_type: "raw",
      type: "upload",
      to_type: "private",
      overwrite: true,
    });
    return { status: "migrated" };
  } catch (error: any) {
    const message = error?.message || String(error);
    if (/not found/i.test(message)) {
      // Ou já não existe, ou já foi movido pra "private" antes (rename com
      // `type: "upload"` não acha mais o recurso na origem).
      return { status: "already-private", detail: message };
    }
    return { status: "error", detail: message };
  }
}

/**
 * URL de entrega do arquivo pro frontend. Imagem/vídeo continuam servidos
 * pelo CDN público normal (não afetado pelo bloqueio). Arquivos "raw" (PDF,
 * docx, zip etc) foram upados como delivery type "private" — a única forma
 * confirmada de driblar o bloqueio de conta é gerar a URL de download
 * assinada via Admin API (domínio api.cloudinary.com, não res.cloudinary.com).
 */
export function getSignedDeliveryUrl(params: {
  publicId: string;
  fileUrl: string;
  fileName?: string | null;
  fileType?: string | null;
}): string {
  const { publicId, fileUrl, fileName, fileType } = params;
  const resourceType = resourceTypeForMime(fileType ?? undefined);
  if (resourceType !== "raw") return fileUrl;

  const format = extensionFromFileName(fileName ?? undefined);
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: "raw",
    type: "private",
  });
}
