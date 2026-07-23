export interface AgentContext {
  agentId: string;
  // null quando o agente é invocado fora de uma Room de escritório — ex.
  // conversas do hub /office/agents (AgentConversation), que não têm sala.
  roomId: string | null;
  channelId?: string | null;
  callSessionId: string | null;
  userId: string;
  companyId: string;
  /** Tarefa mencionada com #Task na mensagem de chat que disparou a consulta (se houver). */
  taskId?: string | null;
  /** Documentos anexados na mensagem de chat que disparou a consulta (se houver). */
  attachmentIds?: string[];
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
