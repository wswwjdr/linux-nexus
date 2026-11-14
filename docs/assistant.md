# Agent Assistant

[简体中文](智能体助手.md) | English

Open the Assistant from Linux Nexus’s file manager to run model-generated shell commands through the connected file session for diagnostics, file changes, installation, deployment, and service management.

## Configure a model

1. Open **Settings → Assistant → Add provider**.
2. Enter a name, the provider’s API key, and its OpenAI Chat Completions API root, such as `https://provider.example/v1`. Leave `/chat/completions` out of the URL. Remote endpoints require HTTPS. Loopback endpoints can use HTTP.
3. Select **Fetch models** or enter model IDs manually, one per line. Choose a default model. Manual entry is available if fetching fails. You can save multiple providers.
4. Select **Test connection** to check authentication, chat, streaming, and tool calls, then select **Save**. If chat works but tool calls fail, choose a model that supports tool calling.

The defaults are 100 model steps per request and a 120-second timeout per model request. The settings page accepts 1–1000 steps and 5–300 seconds.

## Run a task

Open the Assistant from the file manager toolbar. The task includes the current remote directory and selected files. Ask for a project’s backend port, a log analysis, or a build or deployment. The model chooses each command using the task and observed results.

Manual mode is the default. The app shows the command and its working directory, and waits for approval before running it or sending ordinary input. Automatic mode runs operations within the task’s authorization. The app remembers the selection for each verified server and effective identity and applies it to the next turn.

Command cards show the script, live output, log pages, exit code, and duration. Each command has its own working directory and shell. Long-running commands continue until completion or cancellation. Use the password field on the command card for credentials requested by a running process.

Collapsing the pane or switching tabs leaves tasks running. Each chat runs one turn at a time. Separate chats and file manager operations can run concurrently. The app attempts to stop managed processes on exit. Verify remote state before retrying after a disconnect or an unconfirmed stop.

## Prompts and data

Open **Settings → Assistant** to edit or restore the global prompt. The built-in prompt follows the application language. Custom text is used as written. Under **Server prompt**, choose any saved connection to write a complete override or use the global prompt. The server can be offline. Changes apply on the next turn.

Open **History** to search recent conversations and see their status. Use the action button next to a conversation to rename or delete it. Stop an active conversation before deleting it.

The selected model provider receives commands, raw text output, your request, and relevant context. The password field sends the value directly to the process and masks exact matches in command output. The app encrypts API keys, conversation history, and logs using the system’s encryption service. Verify interrupted commands after restarting. Older history files are left in place. The new history starts empty.
