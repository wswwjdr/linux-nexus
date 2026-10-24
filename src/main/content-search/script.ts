export function buildContentSearchScript(): string {
  return `
set +e
root=$1
query=$2
ignore_case=$3
limit_bytes=$4
fail() {
  printf 'F\\0%s\\0' "$(printf '%s' "$1" | base64 -w0)"
  exit 2
}
if [[ ! -d "$root" ]]; then
  fail '搜索目录不存在或不可访问'
fi
processed_files=0
processed_bytes=0
matched_files=0
matched_lines=0
skipped_large_files=0
skipped_binary_files=0
read_errors=0
scanned_files=0
last_update=$SECONDS
last_path=''
emit_progress() {
  local path64=''
  if [[ -n "\${1:-}" ]]; then path64=$(printf '%s' "$1" | base64 -w0); fi
  printf 'P\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0' \\
    "$processed_files" "$processed_bytes" "$matched_files" "$matched_lines" \\
    "$skipped_large_files" "$skipped_binary_files" "$read_errors" "$path64"
}
grep_flags=(-F -H -n -C 1 -Z --no-group-separator)
if [[ "$ignore_case" == '1' ]]; then grep_flags+=(-i); fi
batch_paths=()
batch_sizes=()
flush_batch() {
  ((\${#batch_paths[@]})) || return 0
  local output_path line current_path='' current_size=0 current_has_result=0 index binary_path binary_prefix binary_found
  exec 4< <(grep "\${grep_flags[@]}" -- "$query" "\${batch_paths[@]}")
  local grep_pid=$!
  while IFS= read -r -d '' output_path <&4 || [[ -n "$output_path" ]]; do
    while [[ -n "$output_path" ]]; do
      if [[ "$output_path" == 'Binary file '* ]]; then
        binary_found=0
        for ((index = 0; index < \${#batch_paths[@]}; index++)); do
          binary_path=\${batch_paths[index]}
          binary_prefix="Binary file $binary_path matches"$'\\n'
          if [[ "$output_path" == "$binary_prefix"* ]]; then
            if [[ "$binary_path" != "$current_path" ]]; then
              if [[ -n "$current_path" && $current_has_result -eq 1 ]]; then
                printf 'Z\\0'
                matched_files=$((matched_files + 1))
              fi
              current_path=$binary_path
              current_size=\${batch_sizes[index]}
              current_has_result=0
            fi
            skipped_binary_files=$((skipped_binary_files + 1))
            output_path=\${output_path#"$binary_prefix"}
            binary_found=1
            break
          fi
        done
        if (( ! binary_found )); then
          read_errors=$((read_errors + 1))
          break 2
        fi
        continue
      fi
      IFS= read -r line <&4 || break 2
      if [[ "$output_path" != "$current_path" ]]; then
        if [[ -n "$current_path" && $current_has_result -eq 1 ]]; then
          printf 'Z\\0'
          matched_files=$((matched_files + 1))
        fi
        current_path=$output_path
        current_size=0
        current_has_result=0
        for ((index = 0; index < \${#batch_paths[@]}; index++)); do
          if [[ "\${batch_paths[index]}" == "$current_path" ]]; then
            current_size=\${batch_sizes[index]}
            break
          fi
        done
      fi
      if [[ ! "$line" =~ ^[0-9]+[:-] ]]; then
        read_errors=$((read_errors + 1))
        output_path=''
        continue
      fi
      if (( ! current_has_result )); then
        path64=$(printf '%s' "$current_path" | base64 -w0)
        printf 'R\\0%s\\0%s\\0' "$current_size" "$path64"
        current_has_result=1
      fi
      line64=$(printf '%s' "$line" | base64 -w0)
      printf 'L\\0%s\\0' "$line64"
      if [[ "$line" =~ ^[0-9]+: ]]; then matched_lines=$((matched_lines + 1)); fi
      output_path=''
    done
  done
  exec 4<&-
  wait "$grep_pid"
  if [[ -n "$current_path" && $current_has_result -eq 1 ]]; then
    printf 'Z\\0'
    matched_files=$((matched_files + 1))
  fi
  batch_paths=()
  batch_sizes=()
}
exec 3< <(find -- "$root" -type f -printf '%s\\0%p\\0')
find_pid=$!
while IFS= read -r -d '' size <&3; do
  IFS= read -r -d '' path <&3 || break
  scanned_files=$((scanned_files + 1))
  last_path=$path
  if (( size > limit_bytes )); then
    skipped_large_files=$((skipped_large_files + 1))
  else
    processed_files=$((processed_files + 1))
    processed_bytes=$((processed_bytes + size))
    batch_paths+=("$path")
    batch_sizes+=("$size")
    if (( \${#batch_paths[@]} >= 64 )); then flush_batch; fi
  fi
  if (( scanned_files % 250 == 0 || SECONDS > last_update )); then
    emit_progress "$path"
    last_update=$SECONDS
  fi
done
exec 3<&-
wait "$find_pid"
find_status=$?
flush_batch
emit_progress "$last_path"
printf 'D\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0' \\
  "$processed_files" "$processed_bytes" "$matched_files" "$matched_lines" \\
  "$skipped_large_files" "$skipped_binary_files" "$read_errors"
exit "$find_status"
`
}
