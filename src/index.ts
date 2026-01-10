import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import authRoutes from "./routes/auth.routes";
import companyRoutes from "./routes/company.routes";
import roomRoutes from "./routes/room.routes";
import categoryRoutes from "./routes/category.routes";
import { WebSocketServer } from "./ws/socket-server";

const app = express();
const port = process.env.PORT || 3001;

// Create HTTP server
const httpServer = createServer(app);

// Initialize WebSocket server
WebSocketServer.getInstance(httpServer);

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Pingr API is running!" });
});

app.use("/companies", companyRoutes);
app.use("/auth", authRoutes);
app.use("/rooms", roomRoutes);
app.use("/categories", categoryRoutes);

httpServer.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
