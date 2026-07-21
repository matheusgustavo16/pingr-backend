import { AgentKind, AgentLLMProvider } from "@prisma/client";
import { prisma } from "../../prisma.service";
import { AgentManagementService } from "../../agent-management.service";
import type { ToolDef } from "./types";

const PROVIDERS = ["ANTHROPIC", "OPENAI", "DEEPSEEK"];

export const manageAgentTool: ToolDef = {
  name: "manageAgent",
  description:
    "Cria, lista, atualiza ou remove agentes customizados da empresa. Restrita ao agente de sistema (Pinguelo) — nenhum agente customizado pode chamar esta tool.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "create", "update", "delete"] },
      agentId: { type: "string", description: "Id do agente alvo (obrigatório para update/delete)." },
      templateId: { type: "string", description: "Id de um template a clonar (opcional, no create)." },
      name: { type: "string", description: "Nome/persona do agente." },
      age: { type: "number", description: "Idade da persona (opcional)." },
      specialty: { type: "string", description: "Especialidade do agente." },
      philosophy: { type: "string", description: "Filosofia de trabalho da persona (opcional)." },
      jobFunction: { type: "string", description: "Função específica do agente." },
      provider: { type: "string", enum: PROVIDERS, description: "Provider de LLM." },
      model: { type: "string", description: "Model override (opcional)." },
      allowedTools: {
        type: "array",
        items: { type: "string" },
        description: "Nomes das tools que este agente pode chamar.",
      },
    },
    required: ["action"],
  },
  run: async (ctx, input) => {
    const callerAgent = await prisma.agent.findUnique({ where: { id: ctx.agentId } });
    if (!callerAgent || callerAgent.kind !== AgentKind.SYSTEM) {
      throw new Error("Apenas o agente de sistema (Pinguelo) pode gerenciar outros agentes");
    }

    const action = String(input?.action ?? "");

    if (action === "list") {
      const agents = await AgentManagementService.listAgentsByCompany(ctx.companyId);
      return agents.map((a) => ({
        id: a.id,
        name: a.name,
        specialty: a.specialty,
        jobFunction: a.jobFunction,
        provider: a.provider,
      }));
    }

    if (action === "create") {
      const name = typeof input?.name === "string" ? input.name : "";
      const specialty = typeof input?.specialty === "string" ? input.specialty : "";
      const jobFunction = typeof input?.jobFunction === "string" ? input.jobFunction : "";

      if (!input?.templateId && (!name || !specialty || !jobFunction)) {
        throw new Error("name, specialty e jobFunction são obrigatórios ao criar sem template");
      }

      const created = await AgentManagementService.createAgent({
        companyId: ctx.companyId,
        createdById: ctx.userId,
        templateId: typeof input?.templateId === "string" ? input.templateId : undefined,
        name,
        age: typeof input?.age === "number" ? input.age : undefined,
        specialty,
        philosophy: typeof input?.philosophy === "string" ? input.philosophy : undefined,
        jobFunction,
        provider: PROVIDERS.includes(input?.provider) ? (input.provider as AgentLLMProvider) : undefined,
        model: typeof input?.model === "string" ? input.model : undefined,
        allowedTools: Array.isArray(input?.allowedTools) ? input.allowedTools : undefined,
      });

      return { id: created.id, name: created.name };
    }

    if (action === "update") {
      const agentId = String(input?.agentId ?? "");
      if (!agentId) throw new Error("agentId é obrigatório para update");

      const updated = await AgentManagementService.updateAgent(agentId, ctx.companyId, {
        name: typeof input?.name === "string" ? input.name : undefined,
        age: typeof input?.age === "number" ? input.age : undefined,
        specialty: typeof input?.specialty === "string" ? input.specialty : undefined,
        philosophy: typeof input?.philosophy === "string" ? input.philosophy : undefined,
        jobFunction: typeof input?.jobFunction === "string" ? input.jobFunction : undefined,
        provider: PROVIDERS.includes(input?.provider) ? (input.provider as AgentLLMProvider) : undefined,
        model: typeof input?.model === "string" ? input.model : undefined,
        allowedTools: Array.isArray(input?.allowedTools) ? input.allowedTools : undefined,
      });

      return { id: updated.id, name: updated.name };
    }

    if (action === "delete") {
      const agentId = String(input?.agentId ?? "");
      if (!agentId) throw new Error("agentId é obrigatório para delete");

      const deleted = await AgentManagementService.deleteAgent(agentId, ctx.companyId);
      return { id: deleted.id, isActive: deleted.isActive };
    }

    throw new Error(`Ação desconhecida: ${action}`);
  },
};
