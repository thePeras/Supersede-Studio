import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const dbFiles = ['app.db', 'app-dev.db']

function hasAppDb(dir: string): boolean {
  return dbFiles.some((f) => fs.existsSync(path.join(dir, f)))
}

function migrate(from: string, to: string) {
  if (from === to || !fs.existsSync(from) || !hasAppDb(from) || hasAppDb(to)) return
  try {
    fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
    const oldVimrc = path.join(to, '.supersedure.vimrc')
    const newVimrc = path.join(to, '.supersede.vimrc')
    if (fs.existsSync(oldVimrc) && !fs.existsSync(newVimrc)) fs.renameSync(oldVimrc, newVimrc)
  } catch (e) {
    console.error(`Failed to migrate user data from ${from} to ${to}`, e)
  }
}

if (!process.env.TEST_MODE) {
  migrate(path.join(app.getPath('appData'), 'supersedure-studio'), app.getPath('userData'))
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) {
    migrate(path.join(portableDir, 'supersedure_studio_data'), path.join(portableDir, 'supersede_studio_data'))
  }
}
