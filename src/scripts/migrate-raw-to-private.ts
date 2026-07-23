import "dotenv/config";
import { prisma } from "../services/prisma.service";
import { migrateRawResourceToPrivate, resourceTypeForMime } from "../services/cloudinary.service";

/**
 * Migra Document/TaskAttachment "raw" (PDF, docx, zip etc — enviados antes
 * do fix de entrega do Cloudinary) do delivery type "upload" (público,
 * bloqueado) pro tipo "private". Idempotente — pode rodar mais de uma vez.
 *
 * Uso:
 *   npx ts-node src/scripts/migrate-raw-to-private.ts             (roda de verdade)
 *   npx ts-node src/scripts/migrate-raw-to-private.ts --dry-run    (só lista o que seria migrado)
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const [documents, attachments] = await Promise.all([
    prisma.document.findMany({
      select: { id: true, publicId: true, fileName: true, fileType: true },
    }),
    prisma.taskAttachment.findMany({
      select: { id: true, publicId: true, fileName: true, fileType: true },
    }),
  ]);

  const rawDocuments = documents.filter((d) => resourceTypeForMime(d.fileType ?? undefined) === "raw");
  const rawAttachments = attachments.filter((a) => resourceTypeForMime(a.fileType ?? undefined) === "raw");

  console.log(`Documents raw: ${rawDocuments.length} / ${documents.length}`);
  console.log(`TaskAttachments raw: ${rawAttachments.length} / ${attachments.length}`);

  if (dryRun) {
    for (const doc of rawDocuments) console.log(`[dry-run] Document ${doc.id} — ${doc.publicId}`);
    for (const att of rawAttachments) console.log(`[dry-run] TaskAttachment ${att.id} — ${att.publicId}`);
    console.log("Dry-run — nada foi alterado no Cloudinary.");
    return;
  }

  const results = { migrated: 0, alreadyPrivate: 0, error: 0 };

  for (const doc of [...rawDocuments, ...rawAttachments]) {
    const result = await migrateRawResourceToPrivate(doc.publicId);
    if (result.status === "migrated") results.migrated++;
    else if (result.status === "already-private" || result.status === "not-found") results.alreadyPrivate++;
    else {
      results.error++;
      console.error(`ERRO ao migrar ${doc.publicId}: ${result.detail}`);
    }
  }

  console.log("Resultado:", results);
}

main()
  .catch((error) => {
    console.error("Falha na migração:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
