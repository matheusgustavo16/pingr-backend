import { createOpenAiCompatibleProvider } from "./openai-compatible-provider";

export const deepseekProvider = createOpenAiCompatibleProvider({
  name: "deepseek",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  defaultModel: "deepseek-chat",
  modelEnv: "DEEPSEEK_MODEL",
});
