import crypto from "crypto";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { IsNull } from "typeorm";
import { ConnectionType } from "@/lib/db/types";
import { IConnection } from "@/common/interfaces/IConnection";
import { IObjectImportStats } from "@/common/interfaces/IObjectImportStats";
import { ConnectionFolder } from "@/common/appdb/models/ConnectionFolder";
import { SavedConnection } from "@/common/appdb/models/saved_connection";
import { AppDbHandlers } from "@/handlers/appDbHandlers";
import { MAX_BATCH_ROWS } from "./import";

export const DBEAVER_CREDENTIALS_KEY = "babb4a9f774ab853c96c2d653dfe544a";

export interface DBeaverProject {
  name: string;
  dir: string;
  connectionCount: number;
}

export interface DBeaverFolder {
  path: string;
  name: string;
  parentPath: string | null;
}

export type DBeaverConnection = Partial<IConnection> & { folderPath: string | null };

export interface DBeaverConversion {
  folders: DBeaverFolder[];
  connections: DBeaverConnection[];
  warnings: string[];
}

export interface DBeaverConvertOptions {
  includePasswords: boolean;
}

type Credentials = Record<string, Record<string, { user?: string; password?: string }>>;

const TYPE_PATTERNS: [RegExp, ConnectionType][] = [
  [/cockroach/, "cockroachdb"],
  [/redshift/, "redshift"],
  [/greenplum|greengage/, "greengage"],
  [/mariadb/, "mariadb"],
  [/tidb/, "tidb"],
  [/starrocks/, "starrocks"],
  [/sqlite/, "sqlite"],
  [/mssql|sqlserver|jtds/, "sqlserver"],
  [/bigquery/, "bigquery"],
  [/postgre/, "postgresql"],
  [/mysql/, "mysql"],
];

const LABEL_COLORS: Record<string, string> = {
  prod: "red",
  test: "orange",
};

const SSL_CA_KEYS = ["ssl.root.cert", "sslRootCert", "ssl.ca.cert", "sslCACert", "ssl.ca"];
const SSL_CERT_KEYS = ["ssl.cert", "sslClientCert", "ssl.client.cert", "ssl.client.certificate"];
const SSL_KEY_KEYS = ["ssl.key", "sslClientKey", "ssl.client.key"];

export function dbeaverWorkspaceCandidates(platform: NodeJS.Platform = process.platform, home = os.homedir(), env = process.env): string[] {
  if (platform === "darwin") {
    return [path.join(home, "Library", "DBeaverData", "workspace6")];
  }
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "DBeaverData", "workspace6")];
  }
  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return [
    path.join(dataHome, "DBeaverData", "workspace6"),
    path.join(home, ".var", "app", "io.dbeaver.DBeaverCommunity", "data", "DBeaverData", "workspace6"),
    path.join(home, "snap", "dbeaver-ce", "current", ".local", "share", "DBeaverData", "workspace6"),
  ];
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dataSourceFiles(projectDir: string): Promise<string[]> {
  const dbeaverDir = path.join(projectDir, ".dbeaver");
  if (!(await exists(dbeaverDir))) return [];
  const entries = await fs.readdir(dbeaverDir);
  return entries
    .filter((e) => /^data-sources.*\.json$/.test(e))
    .sort()
    .map((e) => path.join(dbeaverDir, e));
}

async function readDataSources(projectDir: string): Promise<any> {
  const merged = { folders: {}, connections: {} };
  for (const file of await dataSourceFiles(projectDir)) {
    const json = JSON.parse(await fs.readFile(file, "utf-8"));
    Object.assign(merged.folders, json.folders ?? {});
    Object.assign(merged.connections, json.connections ?? {});
  }
  return merged;
}

async function projectDirsIn(dir: string): Promise<string[]> {
  if ((await dataSourceFiles(dir)).length) return [dir];
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const child = path.join(dir, entry.name);
    if ((await dataSourceFiles(child)).length) result.push(child);
  }
  return result;
}

export async function findDBeaverProjects(workspaceDir?: string): Promise<DBeaverProject[]> {
  const roots = workspaceDir ? [workspaceDir] : dbeaverWorkspaceCandidates();
  const projects: DBeaverProject[] = [];
  for (const root of roots) {
    for (const dir of await projectDirsIn(root)) {
      try {
        const sources = await readDataSources(dir);
        projects.push({
          name: path.basename(dir),
          dir,
          connectionCount: Object.keys(sources.connections).length,
        });
      } catch {
        continue;
      }
    }
  }
  return projects;
}

export function decryptDBeaverCredentials(data: Buffer): Credentials {
  const iv = data.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(DBEAVER_CREDENTIALS_KEY, "hex"), iv);
  const plain = Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]);
  return JSON.parse(plain.toString("utf-8"));
}

function detectType(...hints: (string | undefined)[]): ConnectionType | null {
  const text = hints.filter(Boolean).join(" ").toLowerCase();
  const match = TYPE_PATTERNS.find(([pattern]) => pattern.test(text));
  return match ? match[1] : null;
}

function parseJdbcUrl(url?: string): { subprotocol?: string; host?: string; port?: number; database?: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  if (!url || !url.startsWith("jdbc:")) return { params };
  const rest = url.substring(5);
  const subprotocol = rest.split(":")[0];

  if (subprotocol === "sqlite") {
    return { subprotocol, database: rest.substring("sqlite:".length), params };
  }

  for (const part of rest.split(";").slice(1)) {
    const [k, ...v] = part.split("=");
    if (k) params[k.trim()] = v.join("=");
  }

  const m = rest.match(/^[^:]+(?::[^:/]+)*:\/\/([^/:;?]+)(?::(\d+))?(?:\/([^;?]*))?/);
  if (!m) return { subprotocol, params };
  return {
    subprotocol,
    host: m[1],
    port: m[2] ? Number(m[2]) : undefined,
    database: m[3] || undefined,
    params,
  };
}

function firstProp(props: Record<string, any> | undefined, keys: string[]): string | undefined {
  if (!props) return undefined;
  for (const key of keys) {
    if (props[key]) return String(props[key]);
  }
  return undefined;
}

function toPort(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function folderChain(folderPath: string): DBeaverFolder[] {
  const parts = folderPath.split("/").filter(Boolean);
  return parts.map((name, i) => ({
    path: parts.slice(0, i + 1).join("/"),
    name,
    parentPath: i === 0 ? null : parts.slice(0, i).join("/"),
  }));
}

export function convertDBeaverDataSources(dataSources: any, credentials: Credentials, options: DBeaverConvertOptions): DBeaverConversion {
  const warnings: string[] = [];
  const folders = new Map<string, DBeaverFolder>();
  const connections: DBeaverConnection[] = [];

  const addFolder = (folderPath?: string) => {
    if (!folderPath) return;
    for (const f of folderChain(folderPath)) {
      if (!folders.has(f.path)) folders.set(f.path, f);
    }
  };

  Object.keys(dataSources?.folders ?? {}).forEach(addFolder);

  for (const [id, source] of Object.entries<any>(dataSources?.connections ?? {})) {
    const name = source.name || id;
    const config = source.configuration ?? {};
    const jdbc = parseJdbcUrl(config.url);
    const connectionType = detectType(source.provider, source.driver) ?? detectType(jdbc.subprotocol);

    if (!connectionType) {
      warnings.push(`Skipped "${name}": unsupported driver ${source.driver || source.provider || "unknown"}`);
      continue;
    }

    const creds = credentials[id] ?? {};
    const mainCreds = creds["#connection"] ?? {};
    const savePassword = source["save-password"] !== false && options.includePasswords;

    const conn: DBeaverConnection = {
      name,
      connectionType,
      folderPath: source.folder || null,
      labelColor: LABEL_COLORS[config.type] ?? "default",
    };

    if (connectionType === "sqlite") {
      conn.defaultDatabase = config.database || jdbc.database;
      if (!conn.defaultDatabase) {
        warnings.push(`Skipped "${name}": no SQLite file path`);
        continue;
      }
    } else if (connectionType === "bigquery") {
      const projectId = config.database || jdbc.params.ProjectId;
      const keyFilename = jdbc.params.OAuthPvtKeyPath || config["auth-properties"]?.["key-path"];
      conn.bigQueryOptions = { projectId, keyFilename };
      if (!keyFilename) warnings.push(`"${name}": BigQuery authentication needs to be set up again`);
    } else {
      conn.host = config.host || jdbc.host || "localhost";
      conn.port = toPort(config.port) ?? jdbc.port ?? null;
      conn.defaultDatabase = config.database || jdbc.database || null;
      conn.username = mainCreds.user ?? config.user ?? null;
      if (savePassword) conn.password = mainCreds.password ?? config.password ?? null;
    }

    const handlers = config.handlers ?? {};
    const ssh = handlers.ssh_tunnel;
    if (ssh?.enabled) {
      const props = ssh.properties ?? {};
      const sshCreds = creds["network/ssh_tunnel"] ?? {};
      const authType = String(props.authType ?? "PASSWORD").toUpperCase();
      const sshPassword = savePassword && ssh["save-password"] !== false ? (sshCreds.password ?? ssh.password ?? null) : null;

      conn.sshEnabled = true;
      conn.sshHost = props.host ?? null;
      conn.sshPort = toPort(props.port) ?? 22;
      conn.sshUsername = sshCreds.user ?? ssh.user ?? props.user ?? null;

      if (authType === "PUBLIC_KEY") {
        conn.sshMode = "keyfile";
        conn.sshKeyfile = props.keyPath ?? null;
        conn.sshKeyfilePassword = sshPassword;
      } else if (authType === "AGENT") {
        conn.sshMode = "agent";
      } else {
        conn.sshMode = "userpass";
        conn.sshPassword = sshPassword;
      }
    }

    const sslHandler = Object.entries<any>(handlers).find(([key, h]) => /ssl/i.test(key) && h?.enabled);
    if (sslHandler) {
      const props = sslHandler[1].properties ?? {};
      conn.ssl = true;
      conn.sslCaFile = firstProp(props, SSL_CA_KEYS) ?? null;
      conn.sslCertFile = firstProp(props, SSL_CERT_KEYS) ?? null;
      conn.sslKeyFile = firstProp(props, SSL_KEY_KEYS) ?? null;
    }

    if (connectionType === "sqlserver" && jdbc.params.trustServerCertificate) {
      conn.trustServerCertificate = jdbc.params.trustServerCertificate === "true";
    }

    addFolder(conn.folderPath);
    connections.push(conn);
  }

  const sortedFolders = [...folders.values()].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  return { folders: sortedFolders, connections, warnings };
}

export async function readDBeaverProject(projectDir: string, options: DBeaverConvertOptions): Promise<DBeaverConversion> {
  const files = await dataSourceFiles(projectDir);
  if (!files.length) {
    throw new Error(`No DBeaver data-sources.json in ${projectDir}`);
  }
  const dataSources = await readDataSources(projectDir);

  let credentials: Credentials = {};
  const warnings: string[] = [];
  const credsFile = path.join(projectDir, ".dbeaver", "credentials-config.json");
  if (options.includePasswords && (await exists(credsFile))) {
    try {
      credentials = decryptDBeaverCredentials(await fs.readFile(credsFile));
    } catch (e) {
      warnings.push(`Saved credentials could not be read: ${e.message ?? e}`);
    }
  }

  const result = convertDBeaverDataSources(dataSources, credentials, options);
  result.warnings.unshift(...warnings);
  return result;
}

export async function importDBeaverProject(projectDir: string, parentId: number | null, options: DBeaverConvertOptions): Promise<IObjectImportStats> {
  const { folders, connections, warnings } = await readDBeaverProject(projectDir, options);
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
