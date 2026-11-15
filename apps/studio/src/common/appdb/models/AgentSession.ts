import { Column, Entity, Index } from 'typeorm'
import { ApplicationEntity } from './application_entity'
import type { IdentitySource, TransportAgentSession } from '@/lib/agent/types'

@Entity({ name: 'agent_session' })
export class AgentSession extends ApplicationEntity {
  withProps(props?: any): AgentSession {
    if (props) AgentSession.merge(this, props)
    return this
  }

  @Column({ type: 'varchar', nullable: true })
  clientName: string | null = null

  @Column({ type: 'varchar', nullable: true })
  clientVersion: string | null = null

  @Column({ type: 'varchar', nullable: false, default: '' })
  label = ''

  @Column({ type: 'varchar', nullable: true })
  title: string | null = null

  @Column({ type: 'varchar', nullable: true })
  cwd: string | null = null

  @Column({ type: 'varchar', nullable: false, default: 'client' })
  identitySource: IdentitySource = 'client'

  @Column({ type: 'integer', nullable: true })
  pid: number | null = null

  @Column({ type: 'integer', nullable: true })
  parentSessionId: number | null = null

  @Index()
  @Column({ type: 'datetime', nullable: false })
  lastSeenAt: Date = new Date()

  toTransport(): TransportAgentSession {
    return {
      id: this.id,
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      label: this.label,
      title: this.title,
      cwd: this.cwd,
      identitySource: this.identitySource,
      firstSeenAt: this.createdAt,
      lastSeenAt: this.lastSeenAt,
    }
  }
}
