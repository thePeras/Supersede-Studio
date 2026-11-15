import { IsNull } from "typeorm";
import { IConnection } from "@/common/interfaces/IConnection";
import { IObjectImportStats } from "@/common/interfaces/IObjectImportStats";
import { ConnectionFolder } from "@/common/appdb/models/ConnectionFolder";
import { SavedConnection } from "@/common/appdb/models/saved_connection";
import { AppDbHandlers } from "@/handlers/appDbHandlers";
import { MAX_BATCH_ROWS } from "./import";

export interface ImportedFolder {
  path: string;
  name: string;
  parentPath: string | null;
}

export type ImportedConnection = Partial<IConnection> & { folderPath: string | null };

export interface ConnectionConversion {
  folders: ImportedFolder[];
  connections: ImportedConnection[];
  warnings: string[];
}

export async function saveImportedConnections({ folders, connections, warnings }: ConnectionConversion, parentId: number | null): Promise<IObjectImportStats> {
  const stats: IObjectImportStats = { warnings, directories: 0, items: 0 };

  const folderIds = new Map<string, number | null>();
  for (const folder of folders) {
    const folderParentId = folder.parentPath ? folderIds.get(folder.parentPath) : (parentId ?? null);
    const existing = await ConnectionFolder.findOneBy({ name: folder.name, parentId: folderParentId ?? IsNull() });
    if (existing) {
      folderIds.set(folder.path, existing.id);
      continue;
    }
    const saved = await AppDbHandlers["appdb/connectionFolder/save"]({
      obj: { name: folder.name, parentId: folderParentId ?? null } as any,
      options: {},
    });
    folderIds.set(folder.path, (saved as any).id);
    stats.directories++;
  }

  const toSave: Partial<IConnection>[] = [];
  for (const { folderPath, ...conn } of connections) {
    const connectionFolderId = folderPath ? folderIds.get(folderPath) : (parentId ?? null);
    const duplicate = await SavedConnection.findOneBy({ name: conn.name, connectionFolderId: connectionFolderId ?? IsNull() });
    if (duplicate) {
      stats.warnings.push(`Skipped "${conn.name}": a connection with this name already exists in this folder`);
      continue;
    }
    toSave.push({ ...conn, connectionFolderId: connectionFolderId ?? null });
  }

  for (let i = 0; i < toSave.length; i += MAX_BATCH_ROWS) {
    const batch = toSave.slice(i, i + MAX_BATCH_ROWS);
    const saved = await AppDbHandlers["appdb/saved/save"]({ obj: batch as any, options: {} });
    stats.items += (saved as any[]).length;
  }

  return stats;
}
