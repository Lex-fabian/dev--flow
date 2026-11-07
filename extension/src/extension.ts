import * as vscode from 'vscode'
import { TicketsProvider, TicketItem } from './ticketsProvider'
import { getWorkspaceGitInfo, autoDetectProject } from './gitHelper'
import { fetchUserProjects, DevFlowProject } from './api'

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
  statusBar.text = '$(pulse) Dev Flow: Cargando...'
  statusBar.tooltip = 'Dev Flow - Haz clic para seleccionar o cambiar de proyecto'
  statusBar.command = 'devflow.selectProject'
  statusBar.show()
  context.subscriptions.push(statusBar)

  const updateStatusBar = () => {
    const active = provider.getActiveProject()
    if (active) {
      statusBar.text = `$(pulse) Dev Flow: 📁 ${active.name}`
      statusBar.tooltip = `Proyecto activo: ${active.name}\n${active.github ? 'Repo: ' + active.github : ''}\nHaz clic para cambiar`
    } else {
      statusBar.text = '$(pulse) Dev Flow: 🌐 Todos'
      statusBar.tooltip = 'Mostrando todos los proyectos\nHaz clic para filtrar por proyecto'
    }
  }

  // Listener cuando cambian los datos
  provider.onDidChangeTreeData(() => {
    updateStatusBar()
  })

  // Comando: Conectar cuenta
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

    vscode.window.showInformationMessage('¡Cuenta de Dev Flow conectada con éxito!')
    provider.projects = []
    provider.refresh()
  })
  context.subscriptions.push(connectCmd)

  // Comando: Seleccionar / Cambiar Proyecto
  const selectProjectCmd = vscode.commands.registerCommand('devflow.selectProject', async () => {
    const config = vscode.workspace.getConfiguration('devflow')
    const userId = config.get<string>('userId') || ''

    if (!userId) {
      const connectAction = await vscode.window.showWarningMessage('Primero debes conectar tu cuenta de Dev Flow.', 'Conectar ahora')
      if (connectAction === 'Conectar ahora') {
        vscode.commands.executeCommand('devflow.connect')
      }
      return
    }

    if (provider.projects.length === 0) {
      provider.projects = await fetchUserProjects(userId)
    }

    const { remoteUrl, folderName } = await getWorkspaceGitInfo()
    const detected = autoDetectProject(provider.projects, remoteUrl, folderName)

    interface ProjectQuickPickItem extends vscode.QuickPickItem {
      projectAction: 'auto' | 'all' | 'select'
      projectData?: DevFlowProject
    }

    const items: ProjectQuickPickItem[] = []

    // Opción 1: Auto-detección
    items.push({
      label: '$(sparkle) Auto-detectar por repositorio Git actual',
      description: detected ? `Recomendado: 📁 ${detected.name}` : '(No se encontró coincidencia automática)',
      detail: detected ? `Vincula automáticamente al repositorio: ${detected.github || folderName}` : undefined,
      projectAction: 'auto',
      projectData: detected || undefined,
    })

    // Opción 2: Ver todos
    items.push({
      label: '$(globe) Ver todos los proyectos',
      description: 'Sin filtro de proyecto',
      projectAction: 'all',
    })

    // Opción 3+: Cada proyecto disponible
    if (provider.projects.length > 0) {
      items.push({
        label: 'Tus Proyectos en Dev Flow',
        kind: vscode.QuickPickItemKind.Separator,
        projectAction: 'all',
      })

      for (const p of provider.projects) {
        const isCurrent = provider.activeProject?.id === p.id
        items.push({
          label: `${isCurrent ? '✓ ' : ''}$(folder) ${p.name}`,
          description: p.github ? `GitHub: ${p.github}` : p.description || '',
          projectAction: 'select',
          projectData: p,
        })
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Selecciona el proyecto que deseas gestionar en este espacio de trabajo',
    })

    if (!selected) return

    if (selected.projectAction === 'auto') {
      if (detected) {
        provider.setActiveProject(detected, true)
        vscode.window.showInformationMessage(`✨ Proyecto auto-vinculado: ${detected.name}`)
      } else {
        vscode.window.showInformationMessage('No se detectó un proyecto vinculado al repositorio actual. Mostrando todos.')
        provider.setActiveProject(null, false)
      }
    } else if (selected.projectAction === 'all') {
      provider.setActiveProject(null, false)
      vscode.window.showInformationMessage('Mostrando tickets de todos los proyectos.')
    } else if (selected.projectAction === 'select' && selected.projectData) {
      provider.setActiveProject(selected.projectData, false)
      vscode.window.showInformationMessage(`📁 Proyecto seleccionado: ${selected.projectData.name}`)
    }
  })
  context.subscriptions.push(selectProjectCmd)

  // Comando: Actualizar
  const refreshCmd = vscode.commands.registerCommand('devflow.refresh', () => {
    provider.refresh()
    vscode.window.showInformationMessage('Tablero de Dev Flow actualizado.')
  })
  context.subscriptions.push(refreshCmd)

  // Comando: Detalles y acciones rápidas al hacer clic en un ticket
  const ticketDetailsCmd = vscode.commands.registerCommand('devflow.ticketDetails', async (item: TicketItem) => {
    if (!item?.ticket) return
    const ticket = item.ticket
    const code = `DF-${ticket.id.slice(0, 4)}`

    const actions = [
      {
        label: '$(git-branch) Crear / Cambiar a rama Git',
        description: `feature/${code}-${slugify(ticket.title)}`,
        action: 'branch',
      },
      {
        label: '$(copy) Copiar comando de commit sugerido',
        description: `git commit -m "feat(${code}): ${ticket.title} [fixes ${code}]"`,
        action: 'commit',
      },
      {
        label: '$(edit) Cambiar estado de la tarea',
        description: `Estado actual: ${ticket.status}`,
        action: 'status',
      },
      {
        label: '$(globe) Abrir en Dev Flow Web',
        description: 'Ver detalles completos, comentarios y adjuntos en el navegador',
        action: 'web',
      },
    ]

    const choice = await vscode.window.showQuickPick(actions, {
      placeHolder: `[${code}] ${ticket.title}`,
    })

    if (!choice) return

    switch (choice.action) {
      case 'branch':
        vscode.commands.executeCommand('devflow.createBranch', item)
        break
      case 'commit':
        vscode.commands.executeCommand('devflow.copyCommit', item)
        break
      case 'status':
        vscode.commands.executeCommand('devflow.changeStatus', item)
        break
      case 'web':
        vscode.commands.executeCommand('devflow.openWeb', item)
        break
    }
  })
  context.subscriptions.push(ticketDetailsCmd)

  // Comando: Crear Rama Git
  const branchCmd = vscode.commands.registerCommand('devflow.createBranch', async (item: TicketItem) => {
    if (!item?.ticket) return
    const code = `DF-${item.ticket.id.slice(0, 4)}`
    const slug = slugify(item.ticket.title)
    const branchName = item.ticket.gitBranch || `feature/${code}-${slug}`

    const gitExt = vscode.extensions.getExtension<any>('vscode.git')
    if (gitExt) {
      try {
        const gitApi = gitExt.exports.getAPI(1)
        const repo = gitApi?.repositories?.[0]
        if (repo) {
          await repo.createBranch(branchName, true)
          vscode.window.showInformationMessage(`🌿 Rama '${branchName}' creada y activada con éxito.`)
          return
        }
      } catch {
        // Fallback to terminal
      }
    }

    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Dev Flow')
    terminal.show()
    terminal.sendText(`git checkout -b ${branchName}`)
    vscode.window.showInformationMessage(`🌿 Rama '${branchName}' creada y activada.`)
  })
  context.subscriptions.push(branchCmd)

  // Comando: Copiar Commit sugerido
  const commitCmd = vscode.commands.registerCommand('devflow.copyCommit', async (item: TicketItem) => {
    if (!item?.ticket) return
    const code = `DF-${item.ticket.id.slice(0, 4)}`
    const commitText = `git commit -m "feat(${code}): ${item.ticket.title} [fixes ${code}]"`

    await vscode.env.clipboard.writeText(commitText)
    vscode.window.showInformationMessage(`📋 Commit copiado al portapapeles: ${commitText}`)
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
        { label: 'Sin realizar', status: 'sin-realizar', description: 'Por comenzar' },
        { label: 'En proceso', status: 'en-proceso', description: 'En desarrollo activo' },
        { label: 'Testing', status: 'testing', description: 'En pruebas o revisión' },
        { label: 'Completado', status: 'completado', description: 'Listo y terminado' },
      ],
      { placeHolder: `Cambiar estado de "${item.ticket.title}"` }
    )

    if (selected) {
      vscode.window.showInformationMessage(`Estado marcado como: ${selected.label}.`)
      provider.refresh()
    }
  })
  context.subscriptions.push(statusCmd)
}

export function deactivate() {}
