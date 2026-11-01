import type { OperationExecutionStrategy } from '@shared/types'
import { receiveStagedFile } from '../staged-write'

const moveFlags: Record<OperationExecutionStrategy, string> = {
  force: '-fT',
  skip: '-nT',
  update: '-uT',
}

export function buildUploadCommand(strategy: OperationExecutionStrategy): string {
  return `set -eu
destination=$1
directory=$(dirname -- "$destination")
name=$(basename -- "$destination")
staging=$(mktemp -d -- "$directory/.$name.linux-nexus.XXXXXX")
temporary=$staging/content
trap 'rm -f -- "$temporary"; rmdir -- "$staging"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# The private directory protects incomplete bytes while normal file creation
# inherits the destination directory's default ACL and respects the remote umask.
${receiveStagedFile('$3')}
if [[ -f "$destination" && ! -L "$destination" ]]; then
  cp --attributes-only --preserve=mode -- "$destination" "$temporary"
fi
touch -d "@$2" -- "$temporary"
mv ${moveFlags[strategy]} -- "$temporary" "$destination"
`
}
