import { createOpenAiCompatibleProvider } from "./openai-compatible-provider";

export const openaiProvider = createOpenAiCompatibleProvider({
  name: "openai",
  apiKeyEnv: "OPENAI_API_KEY",
  defaultModel: "gpt-4o",
  modelEnv: "OPENAI_MODEL",
});
