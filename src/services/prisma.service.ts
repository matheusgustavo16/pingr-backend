import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  // min>0 mantém conexões quentes — sem isso, tráfego baixo deixa o pool
  // ocioso e cada request repaga handshake TLS (~650ms, VPS BR <-> Supabase us-east-1).
  min: 2,
  max: 10,
  idleTimeoutMillis: 60_000,
});
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
