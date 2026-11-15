import os from "os";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import Encryptor from "simple-encryptor";
import { ConnectionType, ConnectionTypes } from "@/lib/db/types";
import { IObjectImportStats } from "@/common/interfaces/IObjectImportStats";
import { ConnectionConversion, ImportedConnection, ImportedFolder, saveImportedConnections } from "./connectionImport";

export const BEEKEEPER_KEYFILE_KEY = "38782F413F442A472D4B6150645367566B59703373367639792442264529482B";

export interface BeekeeperDataDir {
  name: string;
  dir: string;
  connectionCount: number;
}

export interface BeekeeperConvertOptions {
  includePasswords: boolean;
}

export interface BeekeeperFolderRow {
  id: number;
  name: string;
  parentId?: number | null;
}

export type BeekeeperConnectionRow = Record<string, any>;

type Decrypt = (value: string) => string | null;

const TYPE_ALIASES: Record<string, ConnectionType> = {
  psql: "postgresql",
  postgres: "postgresql",
  mssql: "sqlserver",
};

const PLAIN_COLUMNS = [
  "name", "host", "port", "username", "domain", "defaultDatabase", "labelColor", "serviceName",
  "socketPath", "sshHost", "sshPort", "sshMode", "sshKeyfile", "sshUsername", "sshKeepaliveInterval",
  "sshBastionHost", "sshBastionHostPort", "sshBastionMode", "sshBastionUsername", "sshBastionKeyfile",
  "sslCaFile", "sslCertFile", "sslKeyFile",
];

const BOOLEAN_COLUMNS = [
  "socketPathEnabled", "sshEnabled", "ssl", "sslRejectUnauthorized", "readOnlyMode",
  "rememberPassword", "trustServerCertificate", "windowsAuthEnabled",
];

const JSON_COLUMNS = ["options", "redshiftOptions", "bigQueryOptions", "libsqlOptions", "sqlServerOptions"];

const ENCRYPTED_JSON_COLUMNS: Record<string, string[]> = {
  azureAuthOptions: ["tenantId", "clientSecret"],
  iamAuthOptions: ["tenantId", "clientSecret"],
};

const SECRET_COLUMNS = ["url", "password", "sshPassword", "sshKeyfilePassword", "sshBastionPassword", "sshBastionKeyfilePassword"];

export function beekeeperDataDirCandidates(platform: NodeJS.Platform = process.platform, home = os.homedir(), env = process.env): { name: string; dir: string }[] {
  if (platform === "darwin") {
    return [{ name: "Beekeeper Studio", dir: path.join(home, "Library", "Application Support", "beekeeper-studio") }];
  }
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return [{ name: "Beekeeper Studio", dir: path.join(appData, "beekeeper-studio") }];
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [
    { name: "Beekeeper Studio", dir: path.join(configHome, "beekeeper-studio") },
    { name: "Beekeeper Studio (Flatpak)", dir: path.join(home, ".var", "app", "io.beekeeperstudio.Studio", "config", "beekeeper-studio") },
    { name: "Beekeeper Studio (Snap)", dir: path.join(home, "snap", "beekeeper-studio", "current", ".config", "beekeeper-studio") },
  ];
}

function appDbPath(dir: string): string {
  return path.join(dir, "app.db");
}

function openAppDb(dir: string): Database.Database {
  const file = appDbPath(dir);
  if (!fs.existsSync(file)) {
    throw new Error(`No Beekeeper Studio app.db in ${dir}`);
  }
  return new Database(file, { readonly: true, fileMustExist: true });
}

function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

export async function findBeekeeperDataDirs(dir?: string): Promise<BeekeeperDataDir[]> {
  const candidates = dir ? [{ name: path.basename(dir), dir }] : beekeeperDataDirCandidates();
  const result: BeekeeperDataDir[] = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(appDbPath(candidate.dir))) continue;
    try {
      const db = openAppDb(candidate.dir);
      try {
        if (!hasTable(db, "saved_connection")) continue;
        const { count } = db.prepare("SELECT COUNT(*) AS count FROM saved_connection").get() as { count: number };
        result.push({ ...candidate, connectionCount: count });
      } finally {
        db.close();
      }
    } catch {
      continue;
    }
  }
  return result;
}

export function readBeekeeperEncryptionKey(keyFileContents: string): string | null {
  try {
    const data = Encryptor(BEEKEEPER_KEYFILE_KEY).decrypt(keyFileContents.trim());
    return data?.encryptionKey ?? null;
  } catch {
    return null;
  }
}

function makeDecrypt(key: string | null): { decrypt: Decrypt; failures: () => number } {
  const encryptor = key ? Encryptor(key) : null;
  let failures = 0;
  const decrypt: Decrypt = (value) => {
    let result: unknown = null;
    try {
      result = encryptor?.decrypt(value) ?? null;
    } catch {
      result = null;
    }
    if (typeof result === "string") return result;
    failures++;
    return null;
  };
  return { decrypt, failures: () => failures };
}

function parseType(value: unknown): ConnectionType | null {
  if (typeof value !== "string") return null;
  const type = (TYPE_ALIASES[value] ?? value) as ConnectionType;
  return ConnectionTypes.some((t) => t.value === type) ? type : null;
}

function parseJson(value: unknown): any {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function orderFolders(rows: BeekeeperFolderRow[]): ImportedFolder[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: ImportedFolder[] = [];
  const visited = new Set<number>();

  const visit = (row: BeekeeperFolderRow, trail: Set<number>) => {
    if (visited.has(row.id)) return;
    const parent = row.parentId != null && !trail.has(row.parentId) ? byId.get(row.parentId) : undefined;
    if (parent) visit(parent, new Set([...trail, row.id]));
    visited.add(row.id);
    ordered.push({
      path: String(row.id),
      name: row.name,
      parentPath: parent ? String(parent.id) : null,
    });
  };

  rows.forEach((row) => visit(row, new Set([row.id])));
  return ordered;
}

export function convertBeekeeperRows(
  connectionRows: BeekeeperConnectionRow[],
  folderRows: BeekeeperFolderRow[],
  encryptionKey: string | null,
  options: BeekeeperConvertOptions
): ConnectionConversion {
  const warnings: string[] = [];
  const folders = orderFolders(folderRows.filter((f) => f.name));
  const folderPaths = new Set(folders.map((f) => f.path));
  const connections: ImportedConnection[] = [];
  const { decrypt, failures } = makeDecrypt(encryptionKey);

  for (const row of connectionRows) {
    const name = row.name || `Connection ${row.id}`;
    const connectionType = parseType(row.connectionType);
    if (!connectionType) {
      warnings.push(`Skipped "${name}": unsupported connection type ${row.connectionType || "unknown"}`);
      continue;
    }

    const folderPath = row.connectionFolderId != null && folderPaths.has(String(row.connectionFolderId))
      ? String(row.connectionFolderId)
      : null;
    const conn: ImportedConnection = { name, connectionType, folderPath };

    for (const column of PLAIN_COLUMNS) {
      if (column in row && row[column] !== undefined) conn[column] = row[column];
    }
    conn.name = name;

    for (const column of BOOLEAN_COLUMNS) {
      if (column in row && row[column] !== null && row[column] !== undefined) conn[column] = !!row[column];
    }

    for (const column of JSON_COLUMNS) {
      const value = parseJson(row[column]);
      if (value !== undefined) conn[column] = value;
    }

    for (const [column, fields] of Object.entries(ENCRYPTED_JSON_COLUMNS)) {
      const value = parseJson(row[column]);
      if (value === undefined) continue;
      for (const field of fields) {
        if (!value[field]) continue;
        if (options.includePasswords) {
          value[field] = decrypt(value[field]);
        } else {
          delete value[field];
        }
      }
      conn[column] = value;
    }

    if (options.includePasswords) {
      for (const column of SECRET_COLUMNS) {
        if (row[column]) conn[column] = decrypt(row[column]);
      }
    }

    connections.push(conn);
  }

  if (failures() > 0) {
    warnings.unshift(encryptionKey
      ? `${failures()} saved secret(s) could not be decrypted and were left blank`
      : "No Beekeeper Studio encryption key found, saved passwords were left blank");
  }

  return { folders, connections, warnings };
}

export async function readBeekeeperDataDir(dir: string, options: BeekeeperConvertOptions): Promise<ConnectionConversion> {
  const db = openAppDb(dir);
  let connectionRows: BeekeeperConnectionRow[];
  let folderRows: BeekeeperFolderRow[] = [];
  try {
    if (!hasTable(db, "saved_connection")) {
      throw new Error(`No saved connections in ${appDbPath(dir)}`);
    }
    connectionRows = db.prepare("SELECT * FROM saved_connection ORDER BY id").all() as BeekeeperConnectionRow[];
    if (hasTable(db, "connection_folder")) {
      folderRows = db.prepare("SELECT * FROM connection_folder ORDER BY id").all() as BeekeeperFolderRow[];
    }
  } finally {
    db.close();
  }

  let encryptionKey: string | null = null;
  const keyFile = path.join(dir, ".key");
  if (fs.existsSync(keyFile)) {
    encryptionKey = readBeekeeperEncryptionKey(await fs.promises.readFile(keyFile, "utf-8"));
  }

  return convertBeekeeperRows(connectionRows, folderRows, encryptionKey, options);
}

export async function importBeekeeperDataDir(dir: string, parentId: number | null, options: BeekeeperConvertOptions): Promise<IObjectImportStats> {
  return await saveImportedConnections(await readBeekeeperDataDir(dir, options), parentId);
}
