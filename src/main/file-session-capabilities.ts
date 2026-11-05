import type { Client } from 'ssh2'
import { runRemoteCommand } from './ssh-commands.ts'

// os-release is data: never source it or evaluate its field values as shell code.
export const detectServerDistribution = `id=''
version=''
while IFS='=' read -r key value || [[ -n "$key" ]]; do
  case "$key" in
    ID|VERSION_ID)
      case "$value" in
        \\"*\\") value=\${value:1:\${#value}-2} ;;
        \\'*\\') value=\${value:1:\${#value}-2} ;;
      esac
      if [[ "$key" == ID ]]; then id=$value; else version=$value; fi
      ;;
  esac
done < /etc/os-release
[[ "$id" =~ ^[a-z0-9._-]+$ && "$version" =~ ^[0-9]+(\\.[0-9]+)*$ ]] || {
  printf '%s\\n' '服务器发行版信息无效：需要有效的 ID 和 VERSION_ID' >&2
  exit 1
}
major=\${version%%.*}
case "$id:$major" in
  ubuntu:*|debian:*) package_manager=apt-get ;;
  centos:7) package_manager=yum ;;
  centos:8|centos:9|centos:10|rhel:8|rhel:9|rhel:10) package_manager=dnf ;;
  *) printf '不支持的服务器发行版: %s %s\\n' "$id" "$version" >&2; exit 1 ;;
esac`

export function buildFileSessionCapabilityScript(): string {
  return `set -eu
export LC_ALL=C
${detectServerDistribution}
for tool in bash cat cp mv rm mkdir rmdir find grep tar sha256sum dd tail head mktemp stat touch chmod readlink du base64 dirname basename sed; do
  command -v "$tool" >/dev/null || { printf '缺少服务器命令: %s\\n' "$tool" >&2; exit 1; }
done
find --version | grep -q 'GNU find' || { printf '%s\\n' '需要 GNU findutils' >&2; exit 1; }
cp --version | grep -q 'GNU coreutils' || { printf '%s\\n' '需要 GNU coreutils' >&2; exit 1; }
grep --version | grep -q 'GNU grep' || { printf '%s\\n' '需要 GNU grep' >&2; exit 1; }
tar --version | grep -q 'GNU tar' || { printf '%s\\n' '需要 GNU tar' >&2; exit 1; }
dd if=/dev/null iflag=skip_bytes,count_bytes skip=0 count=0 status=none
for policy in --overwrite --skip-old-files --keep-newer-files; do
  tar "$policy" --no-same-owner --no-same-permissions --version >/dev/null
done
`
}

export async function verifyFileSessionCapabilities(client: Client): Promise<void> {
  await runRemoteCommand(client, buildFileSessionCapabilityScript())
}
