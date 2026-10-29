// The producer sends this record only after source validation. EOF alone never commits a write.
export function commitRecord(hash: string): Buffer {
  return Buffer.from('LINUX_NEXUS_COMMIT:' + hash + '\n', 'ascii')
}
export function receiveStagedFile(sizeArgument: string): string {
  return `head -c "${sizeArgument}" > "$temporary"
[[ $(stat -c %s -- "$temporary") == "${sizeArgument}" ]] || { printf '%s\\n' '文件字节不完整，未修改目标' >&2; exit 1; }
IFS= read -r commit
actual_hash=$(sha256sum < "$temporary"); actual_hash=\${actual_hash%% *}
[[ $commit == "LINUX_NEXUS_COMMIT:$actual_hash" ]] || { printf '%s\\n' '未收到有效提交记录，未修改目标' >&2; exit 1; }`
}
