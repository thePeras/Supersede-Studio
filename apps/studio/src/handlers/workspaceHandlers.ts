import { promises as fs } from 'fs';
import { IObjectImportStats } from "@/common/interfaces/IObjectImportStats";
import { QueryImporter } from "@/backend/lib/objectimport/query";
import { DBeaverProject, findDBeaverProjects, importDBeaverProject } from "@/backend/lib/objectimport/dbeaver";
import { BeekeeperDataDir, findBeekeeperDataDirs, importBeekeeperDataDir } from "@/backend/lib/objectimport/beekeeper";

export interface IWorkspaceHandlers {
  "workspace/importQueryDirectory": ({ sId, dir, parentId, preserveRoot }: { sId: string, dir: string, parentId: number, preserveRoot: boolean }) => Promise<IObjectImportStats>,
  "workspace/importQueries": ({ sId, paths, parentId }: { sId: string, paths: string[], parentId: number }) => Promise<IObjectImportStats>,
  "workspace/detectDBeaverProjects": ({ sId, workspaceDir }: { sId: string, workspaceDir?: string }) => Promise<DBeaverProject[]>,
  "workspace/importDBeaver": ({ sId, projectDir, parentId, includePasswords }: { sId: string, projectDir: string, parentId: number, includePasswords: boolean }) => Promise<IObjectImportStats>,
  "workspace/detectBeekeeperDataDirs": ({ sId, dataDir }: { sId: string, dataDir?: string }) => Promise<BeekeeperDataDir[]>,
  "workspace/importBeekeeper": ({ sId, dataDir, parentId, includePasswords }: { sId: string, dataDir: string, parentId: number, includePasswords: boolean }) => Promise<IObjectImportStats>
}

export const WorkspaceHandlers: IWorkspaceHandlers = {
  'workspace/importQueryDirectory': async function({ dir, parentId, sId, preserveRoot }: { dir: string, parentId: number, sId: string, preserveRoot: boolean }): Promise<IObjectImportStats> {
    if (typeof dir !== 'string' || dir.length === 0) {
      throw new Error('workspace/importDirectory called with no directory path')
    }

    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      throw new Error('workspace/importDirectory called with non directory path');
    }

    const importer = new QueryImporter();

    const stats = await importer.importDirectory(dir, parentId, preserveRoot);

    return stats;
  },
  'workspace/importQueries': async function({ sId, paths, parentId }: { sId: string, paths: string[], parentId: number }): Promise<IObjectImportStats> {
    const importer = new QueryImporter();

    const stats = await importer.importSelections(paths, parentId);

    return stats;
  },
  'workspace/detectDBeaverProjects': async function({ workspaceDir }: { sId: string, workspaceDir?: string }): Promise<DBeaverProject[]> {
    return await findDBeaverProjects(workspaceDir || undefined);
  },
  'workspace/importDBeaver': async function({ projectDir, parentId, includePasswords }: { sId: string, projectDir: string, parentId: number, includePasswords: boolean }): Promise<IObjectImportStats> {
    if (typeof projectDir !== 'string' || projectDir.length === 0) {
      throw new Error('workspace/importDBeaver called with no project directory');
    }
    return await importDBeaverProject(projectDir, parentId ?? null, { includePasswords: !!includePasswords });
  },
  'workspace/detectBeekeeperDataDirs': async function({ dataDir }: { sId: string, dataDir?: string }): Promise<BeekeeperDataDir[]> {
    return await findBeekeeperDataDirs(dataDir || undefined);
  },
  'workspace/importBeekeeper': async function({ dataDir, parentId, includePasswords }: { sId: string, dataDir: string, parentId: number, includePasswords: boolean }): Promise<IObjectImportStats> {
    if (typeof dataDir !== 'string' || dataDir.length === 0) {
      throw new Error('workspace/importBeekeeper called with no data directory');
    }
    return await importBeekeeperDataDir(dataDir, parentId ?? null, { includePasswords: !!includePasswords });
  }
}
