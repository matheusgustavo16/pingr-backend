import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const docs = await prisma.document.findMany({
  where: { fileName: { contains: "Roteiros para post no Instagram" } },
  select: { id: true, fileName: true, fileType: true, analysisStatus: true, analysisError: true, description: true, createdAt: true, chatMessageId: true },
  orderBy: { createdAt: "desc" },
});
console.log(JSON.stringify(docs, null, 2));
await prisma.$disconnect();
process.exit(0);
