import type { ComponentProps, RefObject } from 'react'
import { Cloud, Copy, LoaderCircle } from 'lucide-react'
import FileBrowser from '../files/FileBrowser'
import FileSessionWorkspace from '../files/FileSessionWorkspace'
import FileContextMenu from '../files/FileContextMenu'
import ServerList from '../../components/ServerList'
import TransferTray from '../../components/TransferTray'
import TerminalPanel from '../../components/TerminalPanel'
import type { FileTypeExtensions, RemoteEntry, ServerProfile } from '@shared/types'
import type {
  BrowserContextMenu,
  FileViewMode,
  ScriptExecutionDialogState,
  SessionContextMenuState,
  SessionTab,
  SortColumn,
  TransferJob,
} from '../../app-types'
import type { useSessionOperations } from './useSessionOperations'
import SessionTabBar from './SessionTabBar'
import type { useRemoteOperations } from '../remote-files/useRemoteOperations'
import type { useProfileManagement } from '../../hooks/useProfileManagement'
import type { ScriptCommandDialog } from '../files/useScriptExecution'
import { errorMessage } from '../../app-utils'

type FileBrowserProps = ComponentProps<typeof FileBrowser>
type FileWorkspaceProps = ComponentProps<typeof FileSessionWorkspace>
type ServerListProps = ComponentProps<typeof ServerList>
type TransferTrayProps = ComponentProps<typeof TransferTray>
type TerminalPanelProps = ComponentProps<typeof TerminalPanel>
type SessionOperations = ReturnType<typeof useSessionOperations>
type RemoteOperations = ReturnType<typeof useRemoteOperations>
type ProfileOperations = ReturnType<typeof useProfileManagement>

interface SessionWorkspaceState {
  sessions: SessionTab[]
  profiles: ServerProfile[]
  offlineProfiles: ServerListProps['profiles']
  activeSession: SessionTab | null
  activeSessionId: string | null
  connectedSessionId: string | null
  currentPath: string
  entries: RemoteEntry[]
  loading: boolean
  viewMode: FileViewMode
  breadcrumbs: Array<{ label: string; path: string }>
  sort: SessionTab['sort']
  sortedEntries: RemoteEntry[]
  operationStatus: 'copy' | 'move' | 'extract' | null
  highlightedPath: string | null
  sessionContextMenu: SessionContextMenuState | null
  browserContextMenu: BrowserContextMenu | null
  searchOpenSessionIds: Set<string>
  scriptCommandDialogs: ReadonlyMap<string, ScriptCommandDialog>
  scriptExecutionDialogs: ReadonlyMap<string, ScriptExecutionDialogState>
  fileTypeExtensions: FileTypeExtensions
  transfers: Record<string, TransferJob>
}

interface SessionWorkspaceActions {
  sessions: Pick<SessionOperations,
    'closeSession' | 'openSessionContextMenu' | 'handleSessionTabContextMenuKeyDown' | 'duplicateSession' | 'reorderSession' | 'activateSession' | 'reconnectSession' | 'navigate'>
  remoteFiles: Pick<RemoteOperations,
    'requestRemoteEntriesDeletion' | 'beginRemoteMove' | 'cancelActiveOperation' | 'extractRemoteArchive'>
  browser: Pick<FileBrowserProps,
    'onOpenEntryContextMenu' | 'onOpenDirectoryContextMenu' | 'onDropUpload' | 'onDropError'>
  serverList: Pick<ServerListProps, 'onAdd' | 'onConnect' | 'onEdit' | 'onSetPinned' | 'onDelete'>
  terminal: {
    onReconnect: SessionOperations['reconnectSession']
    onError: TerminalPanelProps['onError']
  }
  fileWorkspace: Pick<FileWorkspaceProps,
    'showToast' | 'onSearchOpenChange' | 'onWorkspaceOpenChange' | 'onBlockingChange'
    | 'onRegisterPreviewActions' | 'onCloseScriptCommand' | 'onUpdateScriptCommand'
    | 'onSubmitScriptCommand' | 'onCloseScriptExecution' | 'onStopScriptExecution'
    | 'onMenuAction' | 'onOpenExternalLink'>
  loadDirectory: (sessionId: string, remotePath: string) => Promise<boolean>
  setSessionChooserOpen: (open: boolean) => void
  onCancelTransfer: TransferTrayProps['onCancel']
  onDismissTransfer: TransferTrayProps['onDismiss']
  onCloseBrowserContextMenu: () => void
  patchSession: (sessionId: string, patch: Partial<SessionTab>) => void
  toggleSort: (column: SortColumn) => void
}

interface SessionWorkspaceViewProps {
  state: SessionWorkspaceState
  actions: SessionWorkspaceActions
  sessionContextMenuRef: RefObject<HTMLDivElement | null>
  contextMenuAnchorRef: RefObject<HTMLElement | null>
}

export default function SessionWorkspaceView(props: SessionWorkspaceViewProps) {
  const { state, actions, sessionContextMenuRef, contextMenuAnchorRef } = props
  const {
    sessions, profiles, offlineProfiles, activeSession, activeSessionId, connectedSessionId,
    currentPath, entries, loading, viewMode, breadcrumbs, sort, sortedEntries, operationStatus,
    highlightedPath, sessionContextMenu, browserContextMenu, searchOpenSessionIds,
    scriptCommandDialogs, scriptExecutionDialogs,
    fileTypeExtensions, transfers,
  } = state
  const {
    duplicateSession,
    reconnectSession,
    navigate,
  } = actions.sessions
  const { requestRemoteEntriesDeletion, beginRemoteMove, cancelActiveOperation, extractRemoteArchive } = actions.remoteFiles
  const {
    onOpenEntryContextMenu,
    onOpenDirectoryContextMenu,
    onDropUpload,
    onDropError,
  } = actions.browser
  const openEntryContextMenu = onOpenEntryContextMenu
  const openDirectoryContextMenu = onOpenDirectoryContextMenu
  const uploadDroppedEntries = onDropUpload
  const { onAdd, onConnect, onEdit, onSetPinned, onDelete } = actions.serverList
  const {
    showToast,
    onSearchOpenChange: setSearchOpen,
    onWorkspaceOpenChange: setWorkspaceOpen,
    onBlockingChange: setWorkspaceBlocking,
    onRegisterPreviewActions: registerPreviewActions,
    onCloseScriptCommand,
    onUpdateScriptCommand,
    onSubmitScriptCommand,
    onCloseScriptExecution,
    onStopScriptExecution,
    onMenuAction,
    onOpenExternalLink,
  } = actions.fileWorkspace
  const { loadDirectory, setSessionChooserOpen, onCancelTransfer, onDismissTransfer, onCloseBrowserContextMenu } = actions
  const toggleSort = actions.toggleSort
  const patchSession = actions.patchSession
  const reportTerminalError = actions.terminal.onError
  const cancelTransferJob = actions.onCancelTransfer
  const dismissTransfer = actions.onDismissTransfer
  const dispatchFileMenuAction = onMenuAction

  return (
    <>
        <SessionTabBar
          sessions={sessions}
          profiles={profiles}
          activeSessionId={activeSessionId}
          actions={actions.sessions}
          onAdd={() => setSessionChooserOpen(true)}
        />

        {sessionContextMenu && (
          <div
            className="browser-context-menu session-context-menu"
            ref={sessionContextMenuRef}
            role="menu"
            aria-label="会话操作"
            style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button className="entry-context-action" role="menuitem" onClick={() => duplicateSession(sessionContextMenu.sessionId)}>
              <Copy size={16} /> 复制会话
            </button>
          </div>
        )}

        <div className="session-content">
        {activeSession?.kind === 'files' && connectedSessionId ? (
          <div className="files-session-panel" id={'session-panel-' + activeSession.id} role="tabpanel" aria-labelledby={'session-tab-' + activeSession.id}>
            <FileBrowser
              currentPath={currentPath}
              entries={entries}
              loading={loading}
              viewMode={viewMode}
              breadcrumbs={breadcrumbs}
              sort={sort}
              sortedEntries={sortedEntries}
              selectedPaths={activeSession.selectedPaths}
              operationStatus={operationStatus}
              highlightedPath={highlightedPath}
              onViewModeChange={(mode) => patchSession(activeSession.id, { viewMode: mode })}
              onNavigate={navigate}
              onToggleSort={toggleSort}
              onSelectedPathsChange={(selectedPaths) => patchSession(activeSession.id, { selectedPaths })}
              onOpenEntryContextMenu={openEntryContextMenu}
              onOpenDirectoryContextMenu={openDirectoryContextMenu}
              onDeleteEntries={requestRemoteEntriesDeletion}
              onDropUpload={uploadDroppedEntries}
              onDropMove={beginRemoteMove}
              onCancelOperation={cancelActiveOperation}
              onDropError={(error) => showToast('error', errorMessage(error))}
            />
          </div>
        ) : !activeSession ? (
          <ServerList
            profiles={offlineProfiles}
            connectionPending={false}
            onAdd={onAdd}
            onConnect={onConnect}
            onEdit={onEdit}
            onSetPinned={onSetPinned}
            onDelete={onDelete}
          />
        ) : activeSession?.kind === 'terminal' ? null : activeSession ? (
          <div className="session-connection-state" id={'session-panel-' + activeSession.id} role="tabpanel" aria-labelledby={'session-tab-' + activeSession.id}>
            {activeSession.status === 'connecting' ? <LoaderCircle className="spin" size={20} /> : <Cloud size={20} />}
            <strong>{activeSession.status === 'connecting' ? '正在连接服务器' : '会话已断开'}</strong>
            {activeSession.error && <span>{activeSession.error}</span>}
            {activeSession.status === 'disconnected' && <button className="text-button" onClick={() => reconnectSession(activeSession.id)}>重连</button>}
          </div>
        ) : null}

        <div className="terminal-session-stack" hidden={activeSession?.kind !== 'terminal'}>
          {sessions.filter((session) => session.kind === 'terminal').map((session) => (
            <div
              className="terminal-session-pane"
              id={'session-panel-' + session.id}
              role="tabpanel"
              aria-labelledby={'session-tab-' + session.id}
              hidden={activeSessionId !== session.id || activeSession?.kind !== 'terminal'}
              key={session.id}
            >
              {session.status !== 'connected' && (
                <div className={'terminal-session-notice ' + session.status}>
                  {session.error ?? (session.status === 'connecting' ? '正在连接 SSH 终端…' : '等待确认服务器指纹')}
                  {session.status === 'disconnected' && <button className="text-button" onClick={() => reconnectSession(session.id)}>重连</button>}
                </div>
              )}
              <TerminalPanel
                sessionId={session.id}
                active={activeSessionId === session.id && activeSession?.kind === 'terminal'}
                connected={session.status === 'connected'}
                onError={reportTerminalError}
              />
            </div>
          ))}
        </div>

        {sessions.filter((session) => session.kind === 'files').map((session) => {
          const profile = profiles.find((candidate) => candidate.id === session.profileId)
          if (!profile) return null
          const scriptCommandDialog = scriptCommandDialogs.get(session.id)
          return (
            <FileSessionWorkspace
              key={session.id}
              session={session}
              active={activeSessionId === session.id}
              searchOpen={searchOpenSessionIds.has(session.id)}
              scriptCommandDialog={scriptCommandDialog
                ? { name: scriptCommandDialog.entry.name, command: scriptCommandDialog.command }
                : null}
              scriptExecutionDialog={scriptExecutionDialogs.get(session.id) ?? null}
              fileTypeExtensions={fileTypeExtensions}
              showToast={showToast}
              onSearchOpenChange={setSearchOpen}
              onWorkspaceOpenChange={setWorkspaceOpen}
              onBlockingChange={setWorkspaceBlocking}
              onRegisterPreviewActions={registerPreviewActions}
              onCloseScriptCommand={onCloseScriptCommand}
              onUpdateScriptCommand={onUpdateScriptCommand}
              onSubmitScriptCommand={onSubmitScriptCommand}
              onCloseScriptExecution={onCloseScriptExecution}
              onStopScriptExecution={onStopScriptExecution}
              onMenuAction={dispatchFileMenuAction}
              onOpenExternalLink={onOpenExternalLink}
            />
          )
        })}

        {browserContextMenu && activeSession?.kind === 'files' && (
          <FileContextMenu
            context={browserContextMenu}
            position={browserContextMenu}
            fileTypeExtensions={fileTypeExtensions}
            anchorRef={contextMenuAnchorRef}
            onAction={(action, context) => dispatchFileMenuAction(action, context, activeSession.id)}
            onClose={onCloseBrowserContextMenu}
          />
        )}

        </div>

        <TransferTray
          sessionId={activeSessionId}
          transfers={transfers}
          onCancel={cancelTransferJob}
          onDismiss={dismissTransfer}
        />
    </>
  )
}
