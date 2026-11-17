const { spawnSync } = require('node:child_process')
const { version } = require('../package.json')

/**
 * Formats the packaging time for the installer filename.
 * @param {Date} date Packaging time in the machine's local time zone.
 * @returns {string} Timestamp in yyyyMMddHHmm format.
 */
function formatTimestamp(date) {
  const fields = [date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]
  let timestamp = String(date.getFullYear())
  for (const field of fields) {
    timestamp += String(field).padStart(2, '0')
  }
  return timestamp
}

const majorVersion = version.split('.')[0]
const artifactName = `Linux-Nexus-Setup-${majorVersion}.${formatTimestamp(new Date())}.exe`
const result = spawnSync(process.execPath, [
  require.resolve('electron-builder/cli.js'),
  '--win', 'nsis', '--x64', '--publish', 'never',
  `-c.artifactName=${artifactName}`,
  ...process.argv.slice(2)
], { stdio: 'inherit' })

if (result.error) throw result.error
if (result.signal) throw new Error(`electron-builder terminated by ${result.signal}`)
process.exitCode = result.status
