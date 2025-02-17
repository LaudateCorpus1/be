#!/usr/bin/env node

const {argv, execSync, spawnSync} = require('./common')

const fs = require('fs')
const path = require('path')

// Parse args.
let skipGclient = false
let noHistory = false
let noForce = false
let noGoma = false
let extraArgs = ''
let targetCpu = 'x64'
for (const arg of argv) {
  if (arg === '--skip-gclient')
    skipGclient = true
  else if (arg === '--no-history')
    noHistory = true
  else if (arg === '--no-force')
    noForce = true
  else if (arg === '--no-goma')
    noGoma = true
  else if (arg.startsWith('--args='))
    extraArgs = arg.substr(arg.indexOf('=') + 1)
  else if (arg.startsWith('--target-cpu='))
    targetCpu = arg.substr(arg.indexOf('=') + 1)
}

if (!skipGclient) {
  // Fetch depot_tools.
  const DEPOT_TOOLS_URL = 'https://chromium.googlesource.com/chromium/tools/depot_tools.git'
  const depotToolsDir = path.join('vendor', 'depot_tools')
  if (fs.existsSync(depotToolsDir)) {
    execSync('git checkout main', {stdio: 'pipe', cwd: depotToolsDir})
    execSync('git pull', {stdio: 'pipe', cwd: depotToolsDir})
  } else {
    execSync(`git clone ${DEPOT_TOOLS_URL} ${depotToolsDir}`)
  }

  // Must bootstrap depot tools on Windows.
  if (process.platform === 'win32')
    execSync(path.join(depotToolsDir, 'bootstrap', 'win_tools.bat'))

  // If the repo is already fetched, try to reset it first.
  if (!noForce) {
    const electronDir = path.join('src', 'electron')
    if (fs.existsSync(electronDir)) {
      // Get the chromium commit to checkout.
      const content = String(fs.readFileSync(path.join(electronDir, 'DEPS')))
      const commit = content.substr(content.indexOf("'chromium_version':") + 19)
                            .match(/'([0-9a-h\.]+)'/)[1]
      // Reset.
      execSync('git checkout main', {stdio: 'pipe', cwd: 'src'})
      execSync('git fetch', {cwd: 'src'})
      execSync('git reset --hard refs/remotes/origin/main', {stdio: 'pipe', cwd: 'src'})
    }
  }

  // Getting the code.
  let args = noHistory ? '--no-history'
                       : '--with_branch_heads --with_tags'
  if (!noForce)
    args += ' --force'
  // Calling gclient directly would invoke gclient.bat on Windows, which does
  // not work prefectly under some shells.
  execSync(`python vendor/depot_tools/gclient.py sync ${args}`)
}

// Fetch build-tools.
const BUILD_TOOLS_URL = 'https://github.com/electron/build-tools'
const buildToolsDir = path.join('vendor', 'build-tools')
if (fs.existsSync(buildToolsDir)) {
  execSync('git checkout master', {stdio: 'pipe', cwd: buildToolsDir})
  execSync('git pull', {stdio: 'pipe', cwd: buildToolsDir})
} else {
  execSync(`git clone ${BUILD_TOOLS_URL} ${buildToolsDir}`)
}

const goma = require('./vendor/build-tools/src/utils/goma')

// Ensure goma is initialized.
if (!noGoma) {
  const thirdPartyDir = path.join(buildToolsDir, 'third_party')
  if (!fs.existsSync(thirdPartyDir))
    fs.mkdirSync(thirdPartyDir)
  goma.downloadAndPrepare({gomaOneForAll: true})
}

// Switch to src dir.
process.chdir('src')

// Generate configurations.
const configs = {
  'Release': 'release',
  'Default': 'testing',
}
for (const name in configs) {
  const config = targetCpu === 'x64' ? name : `${name}_${targetCpu}`
  let gnArgs = [
    `import("//electron/build/args/${configs[name]}.gn")`,
    noGoma ? '' : `import("${goma.gnFilePath}")`,
    `target_cpu="${targetCpu}"`,
    extraArgs,
  ].join(' ' )
  spawnSync('python', ['third_party/depot_tools/gn.py', 'gen', `out/${config}`, `--args=${gnArgs}`])
}
