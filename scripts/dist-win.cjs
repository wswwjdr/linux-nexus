const { spawnSync } = require('node:child_process')
const { existsSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { build, version } = require('../package.json')

/**
 * Formats the packaging time for the installer filename.
 * @param {Date} date Packaging instant to format in Beijing time.
 * @returns {string} Timestamp in yyyyMMddHHmm format.
 */
function formatTimestamp(date) {
  const fields = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(fields.map(({ type, value }) => [type, value]))
  return values.year + values.month + values.day + values.hour + values.minute
}

const majorVersion = version.split('.')[0]
const releaseVersion = `${majorVersion}.${formatTimestamp(new Date())}`
const outputDirectory = resolve(__dirname, '..', build.directories.output)
const artifactName = `Linux-Nexus-Setup-${releaseVersion}.exe`
const artifact = resolve(outputDirectory, artifactName)
const manifest = resolve(outputDirectory, 'release_version')
const stagedManifest = resolve(outputDirectory, `.release_version-${process.pid}.tmp`)
if (existsSync(artifact)) throw new Error(`Release ${releaseVersion} already has an installer. Package again after the minute changes.`)
const result = spawnSync(process.execPath, [
  require.resolve('electron-builder/cli.js'),
  '--win', 'nsis', '--x64', '--publish', 'never',
  ...process.argv.slice(2),
  `-c.artifactName=${artifactName}`,
  // The prefix prevents CLI numeric coercion from changing the version string.
  `-c.extraMetadata.linuxNexusReleaseVersion=release-${releaseVersion}`,
], { stdio: 'inherit' })

if (result.error) throw result.error
if (result.signal) throw new Error(`electron-builder terminated by ${result.signal}`)
process.exitCode = result.status
if (result.status === 0 && existsSync(artifact)) {
  try {
    writeFileSync(stagedManifest, releaseVersion, { flag: 'wx' })
    renameSync(stagedManifest, manifest)
  } finally {
    rmSync(stagedManifest, { force: true })
  }
}
