import { Check, LoaderCircle, Terminal, X } from 'lucide-react'
import ScriptExecutionDialog from '../ScriptExecutionDialog'
import type { DialogLayerProps } from './types'

export function DirectoryScriptDialogs(props: Pick<DialogLayerProps, "createDirectoryDialog" | "creatingDirectory" | "onCloseCreateDirectory" | "onUpdateCreateDirectoryName" | "onSubmitCreateDirectory" | "scriptCommandDialog" | "onCloseScriptCommand" | "onUpdateScriptCommand" | "onSubmitScriptCommand" | "scriptExecutionDialog" | "onCloseScriptExecution" | "onStopScriptExecution">) {
  const { createDirectoryDialog, creatingDirectory, onCloseCreateDirectory, onUpdateCreateDirectoryName, onSubmitCreateDirectory, scriptCommandDialog, onCloseScriptCommand, onUpdateScriptCommand, onSubmitScriptCommand, scriptExecutionDialog, onCloseScriptExecution, onStopScriptExecution } = props
  return (
    <>
      {createDirectoryDialog && (
              <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !creatingDirectory && onCloseCreateDirectory()}>
                <section className="modal create-directory-modal" role="dialog" aria-modal="true" aria-labelledby="create-directory-title">
                  <div className="modal-heading">
                    <div>
                      <h2 id="create-directory-title">新建文件夹</h2>
                    </div>
                    <button className="icon-button modal-close" title="关闭" aria-label="关闭" disabled={creatingDirectory} onClick={onCloseCreateDirectory}><X size={18} /></button>
                  </div>
                  <form onSubmit={onSubmitCreateDirectory}>
                    <label className="field">
                      <span>名称</span>
                      <input
                        autoFocus
                        autoCapitalize="none"
                        autoComplete="off"
                        required
                        disabled={creatingDirectory}
                        value={createDirectoryDialog.name}
                        onChange={(event) => onUpdateCreateDirectoryName(event.target.value)}
                        placeholder="文件夹名称"
                      />
                    </label>
                    <div className="modal-footer">
                      <button type="button" className="secondary-button" disabled={creatingDirectory} onClick={onCloseCreateDirectory}>取消</button>
                      <button type="submit" className="primary-button" disabled={creatingDirectory}>
                        {creatingDirectory ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                        {creatingDirectory ? '创建中' : '创建'}
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            )}
      {scriptCommandDialog && (
              <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCloseScriptCommand()}>
                <section className="modal script-command-modal" role="dialog" aria-modal="true" aria-labelledby="script-command-title">
                  <div className="modal-heading">
                    <div>
                      <h2 id="script-command-title">调整并执行</h2>
                      <div className="script-command-file">{scriptCommandDialog.name}</div>
                    </div>
                    <button className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={onCloseScriptCommand}><X size={18} /></button>
                  </div>
                  <form onSubmit={onSubmitScriptCommand}>
                    <label className="field">
                      <span>命令</span>
                      <textarea autoFocus required maxLength={65535} rows={5} spellCheck={false} value={scriptCommandDialog.command} onChange={(event) => onUpdateScriptCommand(event.target.value)} />
                    </label>
                    <div className="modal-footer">
                      <button type="button" className="secondary-button" onClick={onCloseScriptCommand}>取消</button>
                      <button type="submit" className="primary-button" disabled={!scriptCommandDialog.command.trim()}><Terminal size={15} /> 执行</button>
                    </div>
                  </form>
                </section>
              </div>
            )}
      {scriptExecutionDialog && (
              <ScriptExecutionDialog
                execution={scriptExecutionDialog}
                onClose={onCloseScriptExecution}
                onStop={onStopScriptExecution}
              />
            )}
    </>
  )
}
