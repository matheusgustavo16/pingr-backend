import type { Agent } from "@prisma/client";
import type { AgentContext } from "../tools/types";

export interface DocumentContext {
  documentName: string;
  pageNumber: number;
  totalPages?: number;
  selectedText?: string;
  pageText?: string;
}

export interface BuildSystemPromptOptions {
  /** Threading de histórico ativo pra esta chamada (ver runAgentQuery `history`) —
   *  muda a instrução de "mensagem única" pra uma que reconhece o contexto prévio. */
  hasHistory?: boolean;
  documentContext?: DocumentContext;
}

export function buildSystemPrompt(ctx: AgentContext, agent: Agent, options?: BuildSystemPromptOptions): string {
  const persona =
    agent.kind === "SYSTEM"
      ? `Você é o ${agent.name}, o assistente de IA da plataforma de calls/reuniões Pingr.`
      : [
          `Você é ${agent.name}`,
          agent.age ? `${agent.age} anos` : null,
          agent.specialty ? `especialista em ${agent.specialty}` : null,
        ]
          .filter(Boolean)
          .join(", ") + ".";

  const now = new Date();
  const nowLabel = now.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const doc = options?.documentContext;
  const documentParagraph = doc
    ? [
        `O usuário está visualizando o documento "${doc.documentName}"` +
          (doc.totalPages ? `, página ${doc.pageNumber} de ${doc.totalPages}` : `, página ${doc.pageNumber}`) +
          ".",
        doc.selectedText ? `Trecho selecionado pelo usuário: "${doc.selectedText}".` : null,
        doc.pageText
          ? `Texto extraído da página atual (pode incluir ruído de layout): """${doc.pageText.slice(0, 6000)}"""`
          : null,
        "Priorize esse contexto do documento ao responder, a menos que a pergunta do usuário seja claramente sobre outro assunto.",
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  return [
    persona,
    agent.philosophy ? `Sua filosofia de trabalho: ${agent.philosophy}.` : null,
    `Sua função específica é: ${agent.jobFunction}`,
    "Responda sempre em português do Brasil, de forma direta e útil.",
    ctx.roomId ? `Você está atuando na sala ${ctx.roomId}.` : null,
    `Data e hora atuais: ${nowLabel} (fuso America/Sao_Paulo; ISO de referência: ${now.toISOString()}). Use isso pra calcular datas relativas ("amanhã", "semana que vem", "daqui a 2 horas" etc.) e montar startAt/endAt em ISO 8601 corretos.`,
    "Use as ferramentas disponíveis quando precisar de dados reais ou executar uma ação (agenda, sala, integrações, tarefas) — nunca invente dados.",
    "Você só pode chamar uma ferramenta por resposta. Quando decidir usar uma, chame a ferramenta imediatamente nesta mesma resposta — nunca diga \"vou fazer X\" ou \"deixe-me criar Y\" sem de fato chamar a tool correspondente na mesma mensagem.",
    options?.hasHistory
      ? "Esta conversa tem mensagens anteriores no histórico — use esse contexto pra entender referências como \"ela\", \"isso\", \"a página anterior\" etc. Mesmo assim, cada resposta seu ainda deve decidir e chamar a ferramenta imediatamente quando for o caso, nunca só prometer fazer depois."
      : "Esta é uma interação de mensagem única: se você parar pra perguntar um detalhe, essa pergunta já é sua resposta final — o usuário só vai poder responder numa mensagem nova, depois. Por isso, nunca pare a execução pra pedir campos opcionais ou decorativos (título de evento/tarefa, descrição etc.) — preencha com um valor padrão razoável a partir do contexto da conversa (ex: título \"Reunião\" ou \"Call\") e siga em frente com a ação. Só pergunte antes de agir se faltar um dado essencial que é genuinamente impossível de inferir e sem o qual a ferramenta não pode ser chamada de jeito nenhum.",
    "Se não houver ferramenta para o que foi pedido, diga isso claramente em vez de inventar uma resposta.",
    documentParagraph,
  ]
    .filter(Boolean)
    .join(" ");
}
