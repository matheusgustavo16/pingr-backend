import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import authRoutes from "./routes/auth.routes";
import companyRoutes from "./routes/company.routes";
import roomRoutes from "./routes/room.routes";
import categoryRoutes from "./routes/category.routes";
import chatRoutes from "./routes/chat.routes";
import scheduleRoutes from "./routes/schedule.routes";
import integrationRoutes from "./routes/integration.routes";
import webhookRoutes from "./routes/webhook.routes";
import notificationRoutes from "./routes/notification.routes";
import transcriptRoutes from "./routes/transcript.routes";
import agentRoutes from "./routes/agent.routes";
import agentsRoutes from "./routes/agents.routes";
import agentConversationsRoutes from "./routes/agent-conversations.routes";
import taskRoutes from "./routes/task.routes";
import decorationRoutes from "./routes/decoration.routes";
import documentRoutes from "./routes/document.routes";
import knowledgeRoutes from "./routes/knowledge.routes";
import postGeneratorRoutes from "./routes/post-generator.routes";
import { WebSocketServer } from "./ws/socket-server";
import { knowledgeEmbeddingService } from "./services/knowledge/knowledge-embedding.service";
import { postTemplateService } from "./services/post-template/post-template.service";
import { postGenerationService } from "./services/post-generation/post-generation.service";
import { documentAnalysisService } from "./services/document-analysis.service";

const app = express();
const port = process.env.PORT || 3001;

// Create HTTP server
const httpServer = createServer(app);

// Initialize WebSocket server
WebSocketServer.getInstance(httpServer);

app.use(cors());
app.use(express.json({ verify: (req: any, res, buf) => {
  // Preservar o buffer raw para verificação de assinatura do webhook
  req.rawBody = buf;
}}));

app.get("/", (req, res) => {
  res.json({ message: "Pingr API is running!" });
});

app.use("/companies", companyRoutes);
app.use("/auth", authRoutes);
app.use("/rooms", roomRoutes);
app.use("/rooms", transcriptRoutes);
app.use("/categories", categoryRoutes);
app.use("/chat", chatRoutes);
app.use("/schedule", scheduleRoutes);
app.use("/integrations", integrationRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/notifications", notificationRoutes);
app.use("/agent", agentRoutes);
app.use("/agents", agentsRoutes);
app.use("/agent-conversations", agentConversationsRoutes);
app.use("/tasks", taskRoutes);
app.use("/decorations", decorationRoutes);
app.use("/documents", documentRoutes);
app.use("/knowledge", knowledgeRoutes);
app.use("/post-generator", postGeneratorRoutes);

try {
  knowledgeEmbeddingService.startWorker();
} catch (err: any) {
  console.warn(`[knowledge-embedding] worker não iniciado: ${err?.message}`);
}

try {
  postTemplateService.startWorker();
  postGenerationService.startWorker();
} catch (err: any) {
  console.warn(`[post-generator] workers não iniciados: ${err?.message}`);
}

try {
  documentAnalysisService.startWorker();
} catch (err: any) {
  console.warn(`[document-analysis] worker não iniciado: ${err?.message}`);
}

httpServer.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
