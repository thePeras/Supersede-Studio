import { IFileHandlers } from "@/handlers/fileHandlers";
import { IGeneratorHandlers } from "@/handlers/generatorHandlers";
import { IQueryHandlers } from "@/handlers/queryHandlers";
import { ITempHandlers } from "@/handlers/tempHandlers";
import { IConnectionHandlers } from "./connHandlers";
import { IExportHandlers } from "./exportHandlers";
import { IEnumHandlers } from "./enumHandlers";
import { IWorkspaceHandlers } from "@/handlers/workspaceHandlers";
import { IAgentHandlers } from "@/handlers/agentHandlers";

export interface Handlers
  extends IConnectionHandlers,
    IQueryHandlers,
    IGeneratorHandlers,
    IExportHandlers,
    IFileHandlers,
    IEnumHandlers,
    ITempHandlers,
    IWorkspaceHandlers,
    IAgentHandlers
    {}
