import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Bot, Files, Gauge, Info, Network, Settings, X } from 'lucide-react'
import { tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import type { useApplicationSettings } from '@/hooks/useApplicationSettings'
import type { DialogLayerProps } from './types'
import { SettingsPage } from './SettingsPages'
import { SettingsSaveContext, SettingsSaveState, SettingsNavigationContext } from './SettingsSaveState'
import { AssistantDecision } from './AssistantDecision'

export type SettingsPageId = 'general' | 'files' | 'monitoring' | 'assistant' | 'server' | 'about'
export type SettingsPageProps = Pick<
  DialogLayerProps,
  | 'profiles'
  | 'aliasSnapshot'
  | 'aliasProfileId'
  | 'aliasOperationBusy'
  | 'aliasName'
  | 'aliasCommand'
  | 'onSelectAliasProfile'
  | 'onUpdateAliasName'
  | 'onUpdateAliasCommand'
  | 'onSyncAliases'
  | 'onAddAlias'
  | 'onRequestAliasDelete'
> & {
  preferences: ReturnType<typeof useApplicationSettings>
}
const pages = [
  { id: 'general', icon: Settings },
  { id: 'files', icon: Files },
  { id: 'monitoring', icon: Gauge },
  { id: 'assistant', icon: Bot },
  { id: 'server', icon: Network },
  { id: 'about', icon: Info },
] as const

/** Hosts domain editors and resolves pending automatic saves before navigation. @param props Settings model, server actions and dismissal ref. @returns Settings window. */
export function SettingsDialog(props: SettingsPageProps & { dismissRef: Ref<() => void> }) {
  useLanguage()
  const [page, setPage] = useState<SettingsPageId>('general')
  const [pending, setPending] = useState<{ next: () => void }>()
  const [navigating, setNavigating] = useState(false)
  const dialog = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const open = Boolean(props.preferences.settingsForm)
  const { autosave, closeSettingsDialog } = props.preferences
  useEffect(() => {
    if (open) setPage('general')
  }, [open])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    /** Keeps keyboard focus inside the settings dialog. @param event Keyboard event. */
    function trap(event: KeyboardEvent): void {
      if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return
      const elements = [
        ...dialog.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ]
      const first = elements[0],
        last = elements.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      previous?.focus()
    }
  }, [open])

  useEffect(() => {
    if (open) heading.current?.focus()
  }, [page, open])

  /** Flushes edits before changing view. @param next Navigation to perform after saving. @returns Completion of navigation handling. */
  async function navigate(next: () => void): Promise<void> {
    if (navigating || props.aliasOperationBusy) return
    setNavigating(true)
    try {
      if (await autosave.flush()) {
        setPending(undefined)
        next()
      } else setPending({ next })
    } finally {
      setNavigating(false)
    }
  }
  useEffect(() => {
    if (!props.preferences.exitRequest) return
    if (props.aliasOperationBusy) {
      void props.preferences.completeExit(false)
      return
    }
    void navigate(() => {
      void props.preferences.completeExit(true)
    })
  }, [props.preferences.exitRequest])
  useImperativeHandle(props.dismissRef, () => () => {
    void navigate(closeSettingsDialog)
  })
  if (!open) return null
  return (
    <SettingsSaveContext.Provider value={autosave}>
      <SettingsNavigationContext.Provider
        value={(next) => {
          void navigate(next)
        }}
      >
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) void navigate(closeSettingsDialog)
          }}
        >
          <section
            ref={dialog}
            tabIndex={-1}
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
          >
            <header className="modal-heading settings-modal-heading">
              <h2 id="settings-modal-title">{tr('settings.applicationSettings')}</h2>
              <button
                className="icon-button"
                aria-label={tr('settings.closeSettings')}
                disabled={navigating || props.aliasOperationBusy}
                onClick={() => void navigate(closeSettingsDialog)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="settings-layout">
              <nav className="settings-navigation" aria-label={tr('preferences.navigation')}>
                {pages.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={page === id ? 'page' : undefined}
                    disabled={navigating || props.aliasOperationBusy}
                    onClick={() => {
                      if (page !== id)
                        void navigate(() => {
                          setPage(id)
                          heading.current?.focus()
                        })
                    }}
                  >
                    <Icon size={17} />
                    <span>{tr(`preferences.${id}`)}</span>
                  </button>
                ))}
              </nav>
              <div className="settings-content" key={page}>
                <h3 ref={heading} tabIndex={-1} id="settings-page-heading" className="settings-page-title">
                  {tr(`preferences.${page}`)}
                </h3>
                <SettingsPage
                  {...props}
                  page={page}
                  onSelectAliasProfile={(id) => {
                    void navigate(() => props.onSelectAliasProfile(id))
                  }}
                />
              </div>
            </div>
            <footer className="settings-footer">
              <SettingsSaveState />
            </footer>
          </section>
        </div>
        {pending && (
          <AssistantDecision
            title={tr('preferences.unsaved')}
            onCancel={() => {
              setPending(undefined)
              void props.preferences.completeExit(false)
            }}
            actions={
              <>
                <button
                  type="button"
                  className="primary-button"
                  disabled={navigating}
                  onClick={() => void navigate(pending.next)}
                >
                  {tr('assistant.retry')}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={navigating}
                  onClick={() => {
                    autosave.discard()
                    setPending(undefined)
                    pending.next()
                  }}
                >
                  {tr('assistant.discard')}
                </button>
                <button
                  type="button"
                  className="text-button"
                  data-initial-focus
                  onClick={() => {
                    setPending(undefined)
                    void props.preferences.completeExit(false)
                  }}
                >
                  {tr('assistant.cancel')}
                </button>
              </>
            }
          >
            <p>{tr('preferences.unsavedHint')}</p>
            <SettingsSaveState />
          </AssistantDecision>
        )}
      </SettingsNavigationContext.Provider>
    </SettingsSaveContext.Provider>
  )
}
