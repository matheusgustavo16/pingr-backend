import "dotenv/config";
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);
console.log("JWT_SECRET set:", !!process.env.JWT_SECRET);
