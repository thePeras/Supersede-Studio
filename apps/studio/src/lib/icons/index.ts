import { heroicons } from './heroicons'

export function heroIconSvg(name: string): string {
  const paths = (heroicons[name] ?? [])
    .map((d) => `<path stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${paths}</svg>`
}

export function heroIconHtml(name: string, className = '', attrs = ''): string {
  const classes = ['hi-icon', className].filter(Boolean).join(' ')
  return `<i class="${classes}"${attrs ? ` ${attrs}` : ''}>${heroIconSvg(name)}</i>`
}
