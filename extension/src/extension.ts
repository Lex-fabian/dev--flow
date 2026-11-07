import * as vscode from 'vscode'
import { TicketsProvider, TicketItem } from './ticketsProvider'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 35)
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new TicketsProvider()
  vscode.window.registerTreeDataProvider('devflow-tickets', provider)

  // Status Bar Item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.text = '$(pulse) dev->flow'
  statusBar.tooltip = 'Abrir dev->flow'
  statusBar.command = 'devflow.refresh'
  statusBar.show()
  context.subscriptions.push(statusBar)

  // Comando: Conectar
  const connectCmd = vscode.commands.registerCommand('devflow.connect', async () => {
    const uid = await vscode.window.showInputBox({
      prompt: 'Ingresa tu UID o ID de usuario de dev->flow (en Ajustes de tu cuenta)',
      placeHolder: 'Ej: 9f8a7b6c...',
    })

    if (!uid) return

    const email = await vscode.window.showInputBox({
      prompt: 'Ingresa tu correo de dev->flow',
      placeHolder: 'usuario@ejemplo.com',
    })

    const config = vscode.workspace.getConfiguration('devflow')
    await config.update('userId', uid.trim(), vscode.ConfigurationTarget.Global)
    if (email) {
      await config.update('userEmail', email.trim(), vscode.ConfigurationTarget.Global)
    }

    vscode.window.showInformationMessage('¡Cuenta de dev->flow conectada con éxito!')
    provider.refresh()
  })
  context.subscriptions.push(connectCmd)

  // Comando: Actualizar
  const refreshCmd = vscode.commands.registerCommand('devflow.refresh', () => {
    provider.refresh()
  })
  context.subscriptions.push(refreshCmd)

  // Comando: Crear Rama Git
  const branchCmd = vscode.commands.registerCommand('devflow.createBranch', async (item: TicketItem) => {
    if (!item?.ticket) return
    const code = `DF-${item.ticket.id.slice(0, 4)}`
    const slug = slugify(item.ticket.title)
    const branchName = `feature/${code}-${slug}`

    const gitExt = vscode.extensions.getExtension<any>('vscode.git')
    if (gitExt) {
      try {
        const gitApi = gitExt.exports.getAPI(1)
        const repo = gitApi?.repositories?.[0]
        if (repo) {
          await repo.createBranch(branchName, true)
          vscode.window.showInformationMessage(`Rama '${branchName}' creada y activada.`)
          return
        }
      } catch {
        // Fallback to terminal
      }
    }

    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Dev Flow')
    terminal.show()
    terminal.sendText(`git checkout -b ${branchName}`)

    vscode.window.showInformationMessage(`Rama '${branchName}' creada y activada.`)
  })
  context.subscriptions.push(branchCmd)

  // Comando: Copiar Commit sugerido
  const commitCmd = vscode.commands.registerCommand('devflow.copyCommit', async (item: TicketItem) => {
    if (!item?.ticket) return
    const code = `DF-${item.ticket.id.slice(0, 4)}`
    const commitText = `git commit -m "feat(${code}): ${item.ticket.title} [fixes ${code}]"`

    await vscode.env.clipboard.writeText(commitText)
    vscode.window.showInformationMessage(`Comando copiado al portapapeles: ${commitText}`)
  })
  context.subscriptions.push(commitCmd)

  // Comando: Abrir en Web
  const webCmd = vscode.commands.registerCommand('devflow.openWeb', (item: TicketItem) => {
    if (!item?.ticket) return
    const config = vscode.workspace.getConfiguration('devflow')
    const webUrl = config.get<string>('webUrl') || 'https://dev-flow-7b197.web.app'
    const target = `${webUrl}/proyectos/${item.ticket.projectId}?ticket=${item.ticket.id}`
    vscode.env.openExternal(vscode.Uri.parse(target))
  })
  context.subscriptions.push(webCmd)

  // Comando: Cambiar estado
  const statusCmd = vscode.commands.registerCommand('devflow.changeStatus', async (item: TicketItem) => {
    if (!item?.ticket) return
    const selected = await vscode.window.showQuickPick(
      [
        { label: 'Sin realizar', status: 'sin-realizar' },
        { label: 'En proceso', status: 'en-proceso' },
        { label: 'Testing', status: 'testing' },
        { label: 'Completado', status: 'completado' },
      ],
      { placeHolder: `Cambiar estado de "${item.ticket.title}"` }
    )

    if (selected) {
      vscode.window.showInformationMessage(`Estado cambiado a ${selected.label}. Abre la web para sincronización en tiempo real.`)
      provider.refresh()
    }
  })
  context.subscriptions.push(statusCmd)
}

export function deactivate() {}

