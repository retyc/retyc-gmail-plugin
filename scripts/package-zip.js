#!/usr/bin/env node
// Packages dist/ into retyc-gmail-plugin-<version>.zip for store submission.
// Reads the version from package.json. Run via `npm run package` after `npm run build`.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const distDir = path.join(root, 'dist')
const packageDir = path.join(root, 'package')

if (!fs.existsSync(distDir)) {
  console.error('dist/ does not exist. Run `npm run build` first.')
  process.exit(1)
}

fs.mkdirSync(packageDir, { recursive: true })
const archive = path.join(packageDir, `retyc-gmail-plugin-${pkg.version}.zip`)
if (fs.existsSync(archive)) fs.unlinkSync(archive)

execSync(`(cd "${distDir}" && zip -r "${archive}" .)`, { stdio: 'inherit', shell: '/bin/bash' })
console.log(`\nPackaged: ${path.relative(root, archive)}`)
