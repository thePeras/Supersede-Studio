export default {
  name: '20260928_add_agent_access',
  async run(runner) {
    const queries = [
      `ALTER TABLE saved_connection ADD COLUMN agentOptions text not null default '{}'`,
      `ALTER TABLE used_query ADD COLUMN agentCallId integer`,
      `ALTER TABLE used_query ADD COLUMN agentLabel varchar`,
      `CREATE TABLE IF NOT EXISTS agent_session (
        "id"              integer   PRIMARY KEY AUTOINCREMENT NOT NULL,
        "clientName"      varchar,
        "clientVersion"   varchar,
        "label"           varchar   NOT NULL DEFAULT '',
        "title"           varchar,
        "cwd"             varchar,
        "identitySource"  varchar   NOT NULL DEFAULT 'client',
        "pid"             integer,
        "parentSessionId" integer   REFERENCES agent_session (id) ON DELETE SET NULL,
        "lastSeenAt"      datetime  NOT NULL DEFAULT (datetime('now')),
        "createdAt"       datetime  NOT NULL DEFAULT (datetime('now')),
        "updatedAt"       datetime  NOT NULL DEFAULT (datetime('now')),
        "version"         integer   NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS agent_session_last_seen_idx ON agent_session(lastSeenAt)`,
      `CREATE TABLE IF NOT EXISTS agent_call (
        "id"              integer   PRIMARY KEY AUTOINCREMENT NOT NULL,
        "sessionId"       integer   NOT NULL REFERENCES agent_session (id) ON DELETE CASCADE,
        "connectionId"    integer,
        "connectionName"  varchar,
        "database"        varchar,
        "tool"            varchar   NOT NULL,
        "input"           text,
        "sql"             text,
        "kind"            varchar,
        "categories"      varchar,
        "decision"        varchar   NOT NULL DEFAULT 'auto',
        "status"          varchar   NOT NULL DEFAULT 'ok',
        "error"           text,
        "rowCount"        integer,
        "durationMs"      integer,
        "createdAt"       datetime  NOT NULL DEFAULT (datetime('now')),
        "updatedAt"       datetime  NOT NULL DEFAULT (datetime('now')),
        "version"         integer   NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS agent_call_session_idx ON agent_call(sessionId)`,
      `CREATE INDEX IF NOT EXISTS agent_call_connection_idx ON agent_call(connectionId)`,
      `CREATE INDEX IF NOT EXISTS agent_call_created_idx ON agent_call(createdAt)`,
    ]
    for (let i = 0; i < queries.length; i++) {
      await runner.query(queries[i])
    }
  }
}
