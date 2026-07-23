import { getScheduleTool } from "./get-schedule.tool";
import { getRoomInfoTool } from "./get-room-info.tool";
import { getIntegrationStatusTool } from "./get-integration-status.tool";
import { postChatMessageTool } from "./post-chat-message.tool";
import { createScheduleEventTool } from "./create-schedule-event.tool";
import { cancelScheduleEventTool } from "./cancel-schedule-event.tool";
import { createTaskTool } from "./create-task.tool";
import { updateTaskTool } from "./update-task.tool";
import { createFolderTool } from "./create-folder.tool";
import { manageAgentTool } from "./manage-agent.tool";
import { searchKnowledgeBaseTool } from "./search-knowledge-base.tool";
import { generateContentPostsTool } from "./generate-content-posts.tool";
import type { ToolDef } from "./types";

export const agentTools: ToolDef[] = [
  getScheduleTool,
  getRoomInfoTool,
  getIntegrationStatusTool,
  postChatMessageTool,
  createScheduleEventTool,
  cancelScheduleEventTool,
  createTaskTool,
  updateTaskTool,
  createFolderTool,
  manageAgentTool,
  searchKnowledgeBaseTool,
  generateContentPostsTool,
];

export type { ToolDef, AgentContext } from "./types";
