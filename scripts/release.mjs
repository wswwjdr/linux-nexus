import { execFileSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { load } from 'js-yaml'
import { compareReleaseVersions, createReleaseTag, parseReleaseTag } from '../src/shared/release-version.mts'
import { releaseSignaturePayload, verifyInstaller } from '../src/main/update-signature.mts'

const repository = 'wswwjdr/linux-nexus'
const publicKeyPath = 'resources/update-public-key.pem'
const releaseDirectory = 'release'
const manifestName = 'latest.yml'
const signatureName = 'latest.yml.sig'

/**
 * Runs an executable and captures its standard output.
 * @param {string} command Executable name.
 * @param {string[]} args Arguments passed directly to the executable.
 * @returns {string} Standard output.
 */
function run(command, args) {
  const { UPDATE_SIGNING_KEY, ...env } = process.env
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env }).trim()
}

/**
 * Creates a release tag at HEAD and pushes that exact tag to origin.
 * @param {string} major Maintainer-selected major version.
 */
function pushTag(major) {
  const tag = createReleaseTag(major)
  const ref = `refs/tags/${tag}`
  run('git', ['cat-file', '-e', `HEAD:${publicKeyPath}`])
  if (run('git', ['tag', '--list', tag]) || run('git', ['ls-remote', '--tags', 'origin', ref])) {
    throw new Error(`Tag ${tag} already exists. Use the next Beijing minute for a new release.`)
  }
  run('git', ['tag', tag, 'HEAD'])
  try {
    run('git', ['push', '--no-follow-tags', 'origin', `${ref}:${ref}`])
  } catch (error) {
    throw new Error(`Push failed. Retry with git push origin ${ref}.`, { cause: error })
  }
  console.log(`Pushed ${tag}`)
}

/**
 * Creates a project signing keypair without overwriting either key.
 * @param {string} privatePath User-selected private key path outside the repository.
 */
async function createKey(privatePath) {
  if (!privatePath) throw new Error('Provide a private key path outside the repository.')
  const path = resolve(privatePath)
  const privateFile = join(await realpath(dirname(path)), basename(path))
  const workspace = await realpath('.')
  const workspaceRelativePath = relative(workspace, privateFile)
  if (workspaceRelativePath !== '..' && !workspaceRelativePath.startsWith(`..${sep}`) && !isAbsolute(workspaceRelativePath)) {
    throw new Error('Store the private key outside the repository.')
  }
  const existingPublicKey = await lstat(publicKeyPath).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  if (existingPublicKey) throw new Error(`${publicKeyPath} already exists.`)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  await writeFile(privateFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 })
  await writeFile(publicKeyPath, publicKey.export({ format: 'pem', type: 'spki' }), { flag: 'wx' })
  console.log(`Commit ${publicKeyPath} and put the private key in the UPDATE_SIGNING_KEY Actions secret.`)
}

/**
 * Signs verified Windows build artifacts and publishes a complete GitHub release.
 * @param {string} tag Formal release tag.
 */
async function publish(tag) {
  const release = parseReleaseTag(tag)
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== `refs/tags/${tag}`) {
    throw new Error('A tagged GitHub Actions run in the release repository is required.')
  }
  /** @param {string[]} args GitHub release command arguments. @returns {string} Command output. */
  const gitHub = (args) => run('gh', [...args, '--repo', repository])
  const releases = JSON.parse(gitHub(['release', 'list', '--limit', '100', '--json', 'tagName,isDraft,isLatest']))
  const existing = releases.find(item => item.tagName === tag)
  if (existing && !existing.isDraft) {
    console.log(`${tag} is already published.`)
    return
  }
  const latestTag = releases.find(item => item.isLatest)?.tagName
  if (latestTag) {
    const latestVersion = /^v?\d+\.\d+\.\d+$/.test(latestTag)
      ? latestTag.replace(/^v/, '')
      : parseReleaseTag(latestTag).version
    if (compareReleaseVersions(release.version, latestVersion) <= 0) {
      throw new Error(`${tag} must be newer than ${latestTag}.`)
    }
  }

  const manifest = join(releaseDirectory, manifestName)
  const metadata = releaseSignaturePayload(tag, load(await readFile(manifest, 'utf8')))
  const installer = join(releaseDirectory, metadata.filename)
  await verifyInstaller(installer, metadata.sha512)
  if (!process.env.UPDATE_SIGNING_KEY) throw new Error('Configure the UPDATE_SIGNING_KEY Actions secret before publishing.')
  const privateKey = createPrivateKey(process.env.UPDATE_SIGNING_KEY)
  const publicKey = createPublicKey(await readFile(publicKeyPath))
  if (privateKey.asymmetricKeyType !== 'ed25519' || !createPublicKey(privateKey).equals(publicKey)) {
    throw new Error('UPDATE_SIGNING_KEY does not match the project public key.')
  }
  const signature = join(releaseDirectory, signatureName)
  await writeFile(signature, sign(null, metadata.payload, privateKey))
  const files = [installer, `${installer}.blockmap`, manifest, signature]
  if (!existing) gitHub(['release', 'create', tag, '--verify-tag', '--title', `Linux Nexus ${release.displayVersion}`, '--draft', '--generate-notes'])
  gitHub(['release', 'upload', tag, ...files, '--clobber'])
  const assets = JSON.parse(gitHub(['release', 'view', tag, '--json', 'assets'])).assets
  const expectedNames = [metadata.filename, `${metadata.filename}.blockmap`, manifestName, signatureName]
  if (!expectedNames.every(name => assets.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0))) {
    throw new Error('GitHub draft is missing one or more uploaded update assets.')
  }
  gitHub(['release', 'edit', tag, '--draft=false', '--latest'])
}

const [command, value] = process.argv.slice(2)
switch (command) {
  case 'tag':
    pushTag(value)
    break
  case 'key':
    await createKey(value)
    break
  case 'prepare': {
    const release = parseReleaseTag(value)
    const key = createPublicKey(await readFile(publicKeyPath))
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 public key is required.')
    const publicKey = key.export({ format: 'pem', type: 'spki' }).toString().trim()
    await writeFile(process.env.GITHUB_OUTPUT, `version=${release.version}\ndisplay_version=${release.displayVersion}\n`, { flag: 'a' })
    await writeFile(process.env.GITHUB_ENV, `LINUX_NEXUS_UPDATE_PUBLIC_KEY<<UPDATE_PUBLIC_KEY\n${publicKey}\nUPDATE_PUBLIC_KEY\nLINUX_NEXUS_RELEASE_DISPLAY_VERSION=${release.displayVersion}\n`, { flag: 'a' })
    break
  }
  case 'publish':
    await publish(value)
    break
  default:
    throw new Error('Expected tag, key, prepare or publish.')
}
