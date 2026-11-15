# Agent access (MCP)

Supersede Studio exposes saved connections to AI agents (Claude Code, Codex, Antigravity, Claude Desktop, …) through an MCP server. This document describes the design and where each piece lives.

## Goals

- Agents can list and query saved connections without the app duplicating any database code.
- Access is opt-in per connection and configured in the connection form.
- Writes can require approval in the app.
- Every agent call is recorded, grouped by where it came from, and visible in the app.

## Architecture

```
Agent (Claude Code / Codex / Antigravity / Claude Desktop)
  │ stdio (newline-delimited JSON-RPC)
  ▼
mcp-relay.js      launched as: <Supersede executable> <userData>/agent/mcp-relay.js
  │               with ELECTRON_RUN_AS_NODE=1
  │ local socket (unix socket 0600 / Windows named pipe) + token handshake
  ▼
Utility process
  ├─ AgentServer          socket server, one MCP session per relay
  ├─ AgentMcpSession      MCP tools (SDK server over a socket transport)
  ├─ AgentConnectionPool  opens connections with ConnectionProvider (same code as the GUI)
  ├─ classify + policy    decides run / approve / reject from the connection's agentOptions
  ├─ AgentApprovals       asks every window, the first answer wins, 180s timeout = deny
  └─ AgentRecorder        agent_session / agent_call / used_query + live updates
```

### The relay

`src/entrypoints/mcp-relay.ts` is a dependency-free Node script bundled by esbuild into `dist/mcp-relay.js`. On startup the utility process copies it to `<userData>/agent/mcp-relay.js` (`agent-dev/` in development) and writes `endpoint.json` next to it (`0600`) with the socket path and a per-start token. The copy gives agent configs a stable path across app updates and AppImage mounts.

The relay:

1. Reads `endpoint.json`, connects to the socket and sends a `hello` line: token, pid, ppid, cwd and a small allow-list of environment variables (`CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH`).
2. Pipes JSON-RPC lines between stdio and the socket.
3. When the app is not running it answers `initialize` itself with no tools and instructions to open the app, retries the socket every few seconds, replays `initialize` once connected and sends `notifications/tools/list_changed` so the client fetches the real tools. If the app goes away mid-session, in-flight requests get an error and the relay goes back to offline mode.

Nothing but protocol goes to stdout.

### Why the relay carries session information

The agent spawns the relay, so the relay inherits the agent's working directory and environment. Each relay process is one agent client; for Claude Code, Codex and Conductor that is one chat. This gives the session → calls grouping without client hooks.

## Per-connection configuration

`saved_connection.agentOptions` (JSON):

| Field     | Values                                                         | Default       |
| --------- | -------------------------------------------------------------- | ------------- |
| `enabled` | boolean                                                        | `false`       |
| `rules`   | `{ create, update, delete, schema, other }` → `block` \| `ask` \| `allow` | all `block` |

Reads always run. Setting `other` to `allow` runs unrecognized statements without approval, so the UI shows a warning when it is selected; the Full access preset still asks. Older configs with an `access` level (`read`, `approve_writes`, `full`) are converted to the matching preset.

Edited in `AgentAccessForm.vue` (a `ToggleFormArea` with a switch, like the SSH tunnel section), rendered for every database type next to Read Only Mode. It has three presets (Read only, Ask for writes, Full access) and a Block / Ask / Allow control per category; a set that matches no preset shows as Custom. The connection's own Read Only Mode blocks every write.

The configuration is re-read on every tool call, so changes apply as soon as the connection is saved.

## Classification and policy

`src/lib/agent/classify.ts` returns the write categories a query touches. An empty list means a read.

| Category | Statements |
| -------- | ---------- |
| create   | `INSERT`, `REPLACE`; upserts (`ON CONFLICT DO UPDATE`, `ON DUPLICATE KEY UPDATE`) are create + update |
| update   | `UPDATE`; `MERGE` is create + update + delete |
| delete   | `DELETE`, `TRUNCATE` |
| schema   | `CREATE`/`ALTER`/`DROP` of any object, `SELECT INTO`, `RENAME`, `COMMENT ON` |
| other    | everything else: `GRANT`, `CALL`, `SET`, `PRAGMA`, anonymous blocks, `INTO OUTFILE`, unparseable or empty text |

- SQL uses `sql-query-identifier` (the same parser the drivers use for Read Only Mode). A statement is a read only when its execution type is `LISTING` or `INFORMATION`.
- `EXPLAIN ANALYZE` of a modifying statement and data-modifying CTEs get the categories of the statements they run.
- A batch collects the categories of every statement.
- Redis uses the command table from the Redis client: read-only commands are reads, `DEL`/`UNLINK`/`FLUSH*`/pops/removes are delete, admin and unknown commands are other, and every other write (`SET`, `HSET`, `EXPIRE`, …) is create + update, since Redis cannot tell the two apart.

`src/lib/agent/policy.ts` `decide(rules, categories)` follows the strictest rule: any `block` rejects, otherwise any `ask` needs approval, otherwise the query runs.

Limitations: functions with side effects inside a `SELECT` (for example `nextval`) cannot be detected by parsing.

## Read-only sessions

Reads always use a read connection, and writes that pass the policy use a separate writable one. Read connections are opened with the driver's `readOnlyMode` (the app-level check) and `readOnlySession`, which makes the database itself refuse writes where the driver supports it:

| Database | Mechanism |
| -------- | --------- |
| SQLite | file opened with `readonly: true` |
| PostgreSQL, CockroachDB, Greengage | `-c default_transaction_read_only=on` startup option |
| MySQL, MariaDB | `SET SESSION TRANSACTION READ ONLY` on every pooled connection; a connection where it fails is destroyed |
| Redshift, TiDB, StarRocks, Bedrock, SQL Server, BigQuery, Redis | not supported; the app-level check only |

On PostgreSQL and MySQL an agent could try `SET … READ WRITE` in the same query; `SET` is in the `other` category, so it needs approval unless `other` is set to `allow`; even then it is a write, so it runs on the writable connection, never the read-only one. `list_connections` reports `readOnlyEnforcement: "database" | "app"` for each connection.

## Connections

`AgentConnectionPool` keys connections by connection id, database and mode (read-only / writable). Connections open on first use and close after 10 minutes idle. A pooled connection is replaced when the saved connection changes. The open logic is shared with the GUI's `conn/create` (`openDatabaseConnection` in `src/backend/lib/openConnection.ts`).

Connections that need interactive input fail with a clear message instead of prompting:

- passwords not saved (`rememberPassword` off),
- CockroachDB JWT authentication,
- PIN lock mode.

## MCP tools

| Tool               | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `list_connections` | Enabled connections: id, name, type, preset, rules, read-only enforcement. No secrets. |
| `list_databases`   | Databases of a connection.                                      |
| `list_tables`      | Tables and views, optionally for a schema.                      |
| `describe_table`   | Columns, primary key, indexes and foreign keys.                 |
| `run_query`        | Classify, apply the rules, execute.                             |
| `start_session`    | Optional. Starts a titled session for clients that share one relay across chats (Claude Desktop). Other tools accept the returned `session_id`. |

`connection` accepts an id or a name.

## Approvals

When the policy says `approve`, `AgentApprovals`:

1. pushes `agentApprovalRequested` to every window over the utility ports,
2. asks main to bring a window forward (or create one when none is open),
3. waits for `agent/decideApproval` from any window, or 180 seconds (deny),
4. pushes `agentApprovalResolved` so the other windows close the dialog.

Windows opened later fetch pending approvals with `agent/pendingApprovals`.

## Recording

- `agent_session`: one per relay connection (or per `start_session`). Client name and version, label, title, cwd, identity source, first and last seen.
- `agent_call`: every tool call. Session, connection, database, tool, input, SQL, read/write kind, write categories, decision, status, error, row count, duration.
- `used_query.agentCallId` / `used_query.agentLabel`: agent queries appear in the connection's History panel mixed with the user's, with a badge.

After each call the utility pushes `agentActivity` to every window.

### Session labels

`src/lib/agent/identity.ts` labels a session with the Conductor workspace name, else the cwd folder name, else the client name. A `start_session` title takes precedence. The app the agent runs in is not recorded.

## Agents page

`AgentsModal.vue`, opened from Tools → Agents, the connection screen and the core sidebar:

- **Activity**: sessions with their calls, most recent first, plus a flat list filterable by connection, read/write, decision and client.
- **Setup**: one row per client with status (not configured / configured / outdated path), install, remove and a copyable manual snippet.

| Client         | Config                                                          | Method                   |
| -------------- | --------------------------------------------------------------- | ------------------------ |
| Claude Code    | `~/.claude.json` (user scope)                                   | `claude mcp add` via the login shell's PATH, else a copyable command |
| Codex          | `$CODEX_HOME/config.toml` or `~/.codex/config.toml`             | TOML section edit        |
| Antigravity    | `~/.gemini/antigravity/mcp_config.json` if present, else `~/.gemini/config/mcp_config.json` | JSON edit |
| Claude Desktop | `claude_desktop_config.json` in the Claude app data directory   | JSON edit                |

JSON and TOML edits keep a `.bak` copy, write atomically, and refuse to touch a file that does not parse. The server is registered as `supersede-studio` (`supersede-studio-dev` for development builds).

## Not in v1

- Claude Code / Codex hooks for the exact chat id and title.
- MCP elicitation for approving in the chat.
- Unlock prompts for connections that need interactive input.
- Snap and Flatpak packaging (the relay needs the host executable path).
