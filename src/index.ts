import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import companyRoutes from "./routes/company.routes";

const app = express();
const port = process.env.PORT || 4002;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Pingr API is running!" });
});

app.use("/companies", companyRoutes);
app.use("/auth", authRoutes);

app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
