import { createHash, verify, type KeyLike } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { parseReleaseTag } from '../shared/release-version.mts'

/**
 * Validates and serializes the exact release and installer fields covered by the signature.
 * @param tag GitHub release tag.
 * @param metadata Parsed update metadata from the updater or the packager.
 * @returns Validated release metadata and bytes used for signature operations.
 */
export function releaseSignaturePayload(tag: string, metadata: unknown) {
  const release = parseReleaseTag(tag)
  const info = metadata as Partial<{
    version: string
    files: { url: string; sha512: string }[]
    path: string
    sha512: string
    packages: unknown
  }> | null
  const filename = `Linux-Nexus-Setup-${release.displayVersion}.exe`
  const file = Array.isArray(info?.files) && info.files.length === 1 ? info.files[0] : null
  if (info?.version !== release.version || !file || file.url !== filename || info.path !== filename
    || typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
    || Buffer.from(file.sha512, 'base64').toString('base64') !== file.sha512
    || info.sha512 !== file.sha512 || info.packages !== undefined) {
    throw new Error('Update metadata does not match the expected release or installer')
  }
  return {
    ...release,
    filename,
    sha512: file.sha512,
    payload: Buffer.from(JSON.stringify([tag, release.version, filename, file.sha512])),
  }
}

/**
 * Verifies a release with the project public key before an installer can be downloaded.
 * @param tag Expected GitHub release tag.
 * @param metadata Parsed update metadata.
 * @param signature Raw detached Ed25519 signature.
 * @param publicKey Trusted project key.
 * @returns Verified release metadata.
 */
export function verifyReleaseSignature(tag: string, metadata: unknown, signature: Buffer, publicKey: KeyLike) {
  const release = releaseSignaturePayload(tag, metadata)
  if (signature.length !== 64 || !verify(null, release.payload, publicKey, signature)) {
    throw new Error('Update signature verification failed')
  }
  return release
}

/**
 * Checks an installer file against the SHA-512 in its authenticated manifest.
 * @param path Local installer path.
 * @param expectedHash Expected base64 digest.
 */
export async function verifyInstaller(path: string, expectedHash: string): Promise<void> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('base64') !== expectedHash) throw new Error('Installer does not match the manifest SHA-512')
}
