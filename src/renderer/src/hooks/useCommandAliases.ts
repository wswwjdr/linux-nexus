import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CommandAlias,
  CommandAliasConfirmation,
  CommandAliasOperationResult,
  CommandAliasSnapshot,
  ServerProfile,
  TrustHostKeyInput,
} from '@shared/types'
import { validateCommandAlias } from '@shared/command-aliases'
import type { PendingAliasHostKey } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

interface UseCommandAliasesOptions {
  profiles: ServerProfile[]
  showToast: (kind: ToastNotice['kind'], message: string) => void
}

const emptySnapshot = (profileId: string): CommandAliasSnapshot => ({
  profileId,
  aliases: [],
  syncedAt: null,
  status: 'unsynced',
})

export function useCommandAliases({ profiles, showToast }: UseCommandAliasesOptions) {
  const [snapshots, setSnapshots] = useState<Record<string, CommandAliasSnapshot>>({})
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [operation, setOperation] = useState<'working' | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [overwriteConfirmation, setOverwriteConfirmation] = useState<CommandAliasConfirmation | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<CommandAliasConfirmation | null>(null)
  const [pendingHostKey, setPendingHostKey] = useState<PendingAliasHostKey | null>(null)
  const retryAfterTrustRef = useRef<(() => Promise<CommandAliasOperationResult>) | null>(null)

  const refreshSnapshots = useCallback(async () => {
    const nextSnapshots = await window.remoteFiles.listCommandAliasSnapshots()
    setSnapshots(Object.fromEntries(nextSnapshots.map((snapshot) => [snapshot.profileId, snapshot])))
  }, [])

  useEffect(() => {
    void refreshSnapshots().catch((error: unknown) => showToast('error', '读取命令别名失败：' + errorMessage(error)))
  }, [profiles, refreshSnapshots, showToast, overwriteConfirmation, deleteConfirmation])

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null
  const snapshot = useMemo(
    () => selectedProfile ? snapshots[selectedProfile.id] ?? emptySnapshot(selectedProfile.id) : null,
    [selectedProfile, snapshots],
  )

  const prepareForSettings = useCallback((preferredProfileId: string | null) => {
    const nextProfileId = profiles.some((profile) => profile.id === preferredProfileId)
      ? preferredProfileId ?? ''
      : profiles[0]?.id ?? ''
    setSelectedProfileId(nextProfileId)
    setName('')
    setCommand('')
    setOverwriteConfirmation(null)
    setDeleteConfirmation(null)
    void refreshSnapshots().catch((error: unknown) => showToast('error', '读取命令别名失败：' + errorMessage(error)))
  }, [profiles, refreshSnapshots, showToast])

  const selectProfile = (profileId: string) => {
    setSelectedProfileId(profileId)
    setName('')
    setCommand('')
    setOverwriteConfirmation(null)
    setDeleteConfirmation(null)
  }

  const applyResult = (profileId: string, result: CommandAliasOperationResult, retry: () => Promise<CommandAliasOperationResult>): boolean => {
    if (result.status === 'host-key-required') {
      const profile = profiles.find((candidate) => candidate.id === profileId)
      if (!profile) {
        showToast('error', '找不到正在同步别名的服务器')
        return false
      }
      retryAfterTrustRef.current = retry
      setPendingHostKey(result.previousFingerprint
        ? { profile, fingerprint: result.fingerprint, previousFingerprint: result.previousFingerprint }
        : { profile, fingerprint: result.fingerprint })
      return true
    }
    setSnapshots((current) => ({ ...current, [profileId]: result.snapshot }))
    if (result.status === 'updated-sync-failed') {
      showToast('error', '命令别名已修改，但刷新别名列表失败，请重新同步：' + result.message)
    } else {
      setName('')
      setCommand('')
    }
    return false
  }

  const runOperation = async (profileId: string, retry: () => Promise<CommandAliasOperationResult>) => {
    setOperation('working')
    let waitingForTrust = false
    try {
      waitingForTrust = applyResult(profileId, await retry(), retry)
    } catch (error) {
      showToast('error', errorMessage(error))
    } finally {
      if (!waitingForTrust) setOperation(null)
    }
  }

  const sync = () => {
    if (!selectedProfileId || operation) return
    const profileId = selectedProfileId
    void runOperation(profileId, () => window.remoteFiles.syncCommandAliases(profileId))
  }

  const add = () => {
    if (!selectedProfileId || operation || snapshot?.status !== 'synced') return
    try {
      validateCommandAlias(name, command)
    } catch (error) {
      showToast('error', errorMessage(error))
      return
    }
    const profileId = selectedProfileId
    const requestedName = name
    const requestedCommand = command
    const existing = snapshot.aliases.find((alias) => alias.name === requestedName)
    if (existing) {
      if (!existing.removable) {
        showToast('error', existing.removalReason ?? '此别名无法安全覆盖')
        return
      }
      setOverwriteConfirmation({
        profileId,
        operation: 'overwrite',
        name: existing.name,
        existingCommand: existing.command,
        command: requestedCommand,
      })
      return
    }
    void runOperation(profileId, () => window.remoteFiles.saveCommandAlias(profileId, requestedName, requestedCommand))
  }

  const confirmOverwrite = () => {
    if (!selectedProfileId || !overwriteConfirmation || operation) return
    const pending = overwriteConfirmation
    setOverwriteConfirmation(null)
    void runOperation(pending.profileId, () => window.remoteFiles.saveCommandAlias(
      pending.profileId,
      pending.name,
      pending.command!,
      pending.existingCommand,
    ))
  }

  const requestDelete = (alias: CommandAlias) => {
    if (operation || !selectedProfileId) return
    if (!alias.removable) {
      showToast('error', alias.removalReason ?? '此别名无法安全删除')
      return
    }
    setDeleteConfirmation({
      profileId: selectedProfileId,
      operation: 'delete',
      name: alias.name,
      existingCommand: alias.command,
    })
  }

  const confirmDelete = () => {
    if (!selectedProfileId || !deleteConfirmation || operation) return
    const pending = deleteConfirmation
    setDeleteConfirmation(null)
    void runOperation(pending.profileId, () => window.remoteFiles.deleteCommandAlias(
      pending.profileId,
      pending.name,
      pending.existingCommand,
    ))
  }

  const trustHostKey = async () => {
    if (!pendingHostKey || !retryAfterTrustRef.current) return
    const pending = pendingHostKey
    const retry = retryAfterTrustRef.current
    setOperation('working')
    let waitingForTrust = false
    try {
      const trust: TrustHostKeyInput = {
        profileId: pending.profile.id,
        fingerprint: pending.fingerprint,
        previousFingerprint: pending.previousFingerprint,
      }
      await window.remoteFiles.trustHostKey(trust)
      setPendingHostKey(null)
      retryAfterTrustRef.current = null
      waitingForTrust = applyResult(pending.profile.id, await retry(), retry)
    } catch (error) {
      setPendingHostKey(null)
      retryAfterTrustRef.current = null
      showToast('error', errorMessage(error))
    } finally {
      if (!waitingForTrust) setOperation(null)
    }
  }

  const dismissHostKey = () => {
    setPendingHostKey(null)
    retryAfterTrustRef.current = null
    setOperation(null)
  }

  return {
    snapshot,
    selectedProfile,
    selectedProfileId,
    operation,
    name,
    command,
    overwriteConfirmation,
    deleteConfirmation,
    pendingHostKey,
    prepareForSettings,
    selectProfile,
    setName,
    setCommand,
    sync,
    add,
    confirmOverwrite,
    cancelOverwrite: () => setOverwriteConfirmation(null),
    requestDelete,
    confirmDelete,
    cancelDelete: () => setDeleteConfirmation(null),
    trustHostKey,
    dismissHostKey,
  }
}
