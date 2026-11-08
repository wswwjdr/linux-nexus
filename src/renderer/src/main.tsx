import { i18n, renderMessage, messageFromUnknown, tr } from '@shared/i18n/messages'
import { initializeApplication } from './application-settings'
import { createRemoteFilesApi } from './remote-files-api'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import App from './App'
import './styles.css'

async function start(): Promise<void> {
  window.remoteFiles = createRemoteFilesApi(window.remoteFilesTransport)
  const bootstrap = await window.remoteFiles.getBootstrap()
  initializeApplication(bootstrap)
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}><App initialSettings={bootstrap.settings} /></I18nextProvider>
    </React.StrictMode>,
  )
}

void start().catch(error => {
  console.error('Application initialization failed', error)
  const root = document.getElementById('root')!
  root.setAttribute('role', 'alert')
  root.textContent = tr('errors.startupFailed') + ': ' + renderMessage(messageFromUnknown(error))
})
