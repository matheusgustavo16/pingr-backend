import { getScheduleTool } from "./get-schedule.tool";
import { getRoomInfoTool } from "./get-room-info.tool";
import { getIntegrationStatusTool } from "./get-integration-status.tool";
import { postChatMessageTool } from "./post-chat-message.tool";
import type { ToolDef } from "./types";

export const agentTools: ToolDef[] = [
  getScheduleTool,
  getRoomInfoTool,
  getIntegrationStatusTool,
  postChatMessageTool,
];

export type { ToolDef, AgentContext } from "./types";
