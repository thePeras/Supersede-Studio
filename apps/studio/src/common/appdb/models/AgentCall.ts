import { Column, Entity, Index } from 'typeorm'
import { ApplicationEntity } from './application_entity'
import type { CallDecision, CallStatus, QueryKind, TransportAgentCall, WriteCategory } from '@/lib/agent/types'

@Entity({ name: 'agent_call' })
export class AgentCall extends ApplicationEntity {
  withProps(props?: any): AgentCall {
    if (props) AgentCall.merge(this, props)
    return this
  }

  @Index()
  @Column({ type: 'integer', nullable: false })
  sessionId: number

  @Index()
  @Column({ type: 'integer', nullable: true })
  connectionId: number | null = null

  @Column({ type: 'varchar', nullable: true })
  connectionName: string | null = null

  @Column({ type: 'varchar', nullable: true })
  database: string | null = null

  @Column({ type: 'varchar', nullable: false })
  tool: string

  @Column({ type: 'text', nullable: true })
  input: string | null = null

  @Column({ type: 'text', nullable: true })
  sql: string | null = null

  @Column({ type: 'varchar', nullable: true })
  kind: QueryKind | null = null

  @Column({ type: 'varchar', nullable: true })
  categories: string | null = null

  @Column({ type: 'varchar', nullable: false, default: 'auto' })
  decision: CallDecision = 'auto'

  @Column({ type: 'varchar', nullable: false, default: 'ok' })
  status: CallStatus = 'ok'

  @Column({ type: 'text', nullable: true })
  error: string | null = null

  @Column({ type: 'integer', nullable: true })
  rowCount: number | null = null

  @Column({ type: 'integer', nullable: true })
  durationMs: number | null = null

  toTransport(): TransportAgentCall {
    return {
      id: this.id,
      sessionId: this.sessionId,
      connectionId: this.connectionId,
      connectionName: this.connectionName,
      database: this.database,
      tool: this.tool,
      sql: this.sql,
      kind: this.kind,
      categories: this.categories ? (this.categories.split(',') as WriteCategory[]) : [],
      decision: this.decision,
      status: this.status,
      error: this.error,
      rowCount: this.rowCount,
      durationMs: this.durationMs,
      createdAt: this.createdAt,
    }
  }
}
