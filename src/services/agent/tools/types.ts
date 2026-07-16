export interface AgentContext {
  roomId: string;
  callSessionId: string | null;
  userId: string;
  companyId: string;
}

// Schema JSON Schema-like, aceito tanto pelo Anthropic (input_schema) quanto
// pelo OpenAI (function.parameters) sem conversão — mesma definição serve
// para os dois providers.
export interface ToolJsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: ToolJsonSchema;
  run: (ctx: AgentContext, input: any) => Promise<unknown>;
}
