import Vue from 'vue'

export async function loadConnectionColors(): Promise<Record<number, string>> {
  const connections: { id: number, labelColor?: string | null }[] = await Vue.prototype.$util.send('appdb/saved/find', {
    options: { select: ['id', 'labelColor'] },
  })
  return Object.fromEntries(connections.map((c) => [c.id, c.labelColor || 'default']))
}
