import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(path.dirname(require.resolve('heroicons/package.json', { paths: [path.join(root, 'apps/studio')] })), '24', 'outline')
const targets = [
  path.join(root, 'apps/studio/src/lib/icons/heroicons.ts'),
  path.join(root, 'apps/ui-kit/lib/utils/heroicons.ts'),
]
const scssTargets = [
  path.join(root, 'apps/studio/src/assets/styles/app/_heroicons.scss'),
  path.join(root, 'apps/ui-kit/lib/styles/_heroicons.scss'),
]

const icons = fs.readdirSync(sourceDir)
  .filter((file) => file.endsWith('.svg'))
  .sort()
  .map((file) => {
    const svg = fs.readFileSync(path.join(sourceDir, file), 'utf8')
    const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1])
    return { name: file.replace(/\.svg$/, ''), paths }
  })

const ts = icons.map(({ name, paths }) => `  '${name}': ${JSON.stringify(paths)},`)
const output = `export const heroicons: Record<string, string[]> = {\n${ts.join('\n')}\n}\n`
for (const target of targets) fs.writeFileSync(target, output)

const dataUri = (paths) => {
  const body = paths.map((d) => `<path d='${d}'/>`).join('')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E')}")`
}
const scssEntries = icons.map(({ name, paths }) => `  '${name}': ${dataUri(paths)},`)
const scss = `@use 'sass:map';

$heroicons: (
${scssEntries.join('\n')}
);

@mixin hero-icon-image($name) {
  -webkit-mask-image: map.get($heroicons, $name);
  mask-image: map.get($heroicons, $name);
}

@mixin hero-icon($name) {
  content: '';
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  @if $name {
    @include hero-icon-image($name);
  }
}
`
for (const target of scssTargets) fs.writeFileSync(target, scss)
