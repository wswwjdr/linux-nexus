import { useEffect, useRef } from 'react'
import type { DialogLayerProps } from './dialogs/types'
import { ProfileDialogs } from './dialogs/ProfileDialogs'
import { DirectoryDialogs } from './dialogs/DirectoryDialogs'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { SecurityDialogs } from './dialogs/SecurityDialogs'

export type { DialogLayerProps } from './dialogs/types'

export default function DialogLayer(props: DialogLayerProps) {
  const settingsDismiss = useRef<() => void>(null)
  const aliasHostKeyVisible = !props.pendingHostKey && Boolean(props.pendingAliasHostKey)

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return

      if (props.pendingHostKey || props.pendingAliasHostKey) {
        event.preventDefault()
        if (aliasHostKeyVisible) props.onDismissAliasHostKey()
        else props.onDismissHostKey()
        return
      }
      if (props.createDirectoryDialog) {
        event.preventDefault()
        if (!props.creatingDirectory) props.onCloseCreateDirectory()
        return
      }
      if (props.preferences.settingsForm) {
        event.preventDefault()
        if (!props.aliasOperationBusy) settingsDismiss.current?.()
        return
      }
      if (props.profileDialog) {
        event.preventDefault()
        props.onCloseProfile()
      }
    }

    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [
    props.onCloseProfile,
    props.onCloseCreateDirectory,
    props.onDismissHostKey,
    props.onDismissAliasHostKey,
    props.pendingHostKey,
    props.pendingAliasHostKey,
    props.createDirectoryDialog,
    props.creatingDirectory,
    props.preferences.settingsForm,
    props.aliasOperationBusy,
    props.profileDialog,
    aliasHostKeyVisible,
  ])

  return (
    <>
      <ProfileDialogs {...props} />
      <DirectoryDialogs {...props} />
      <SettingsDialog {...props} dismissRef={settingsDismiss} />
      <SecurityDialogs {...props} />
    </>
  )
}
