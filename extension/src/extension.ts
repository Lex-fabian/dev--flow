import * as vscode from 'vscode'
import { TicketsProvider, TicketItem } from './ticketsProvider'
import { getWorkspaceGitInfo, autoDetectProject } from './gitHelper'
import { fetchUserProjects, fetchUserWorkspaces, DevFlowProject, DevFlowWorkspace } from './api'

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

  // URI Handler para vincular automáticamente desde el navegador (vscode://dev-flow.dev-flow/auth?token=...)
  class DevFlowUriHandler implements vscode.UriHandler {
    async handleUri(uri: vscode.Uri) {
      if (uri.path === '/auth') {
        const params = new URLSearchParams(uri.query)
        const token = params.get('token')
        const email = params.get('email')
        const uid = params.get('uid')

        if (token) {
          const config = vscode.workspace.getConfiguration('devflow')
          await config.update('authToken', token, vscode.ConfigurationTarget.Global)
          if (email) await config.update('userEmail', email, vscode.ConfigurationTarget.Global)
          if (uid) await config.update('userId', uid, vscode.ConfigurationTarget.Global)

          provider.workspaces = []
          provider.projects = []
          provider.refresh()

          vscode.window.showInformationMessage(`🎉 ¡Vinculación completada con éxito como ${email || 'usuario'}!`)
        }
      }
    }
  }
  context.subscriptions.push(vscode.window.registerUriHandler(new DevFlowUriHandler()))

  // Status Bar Item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.show()
  context.subscriptions.push(statusBar)

  const updateStatusBar = () => {
    const config = vscode.workspace.getConfiguration('devflow')
    const userEmail = config.get<string>('userEmail') || ''
    const userId = config.get<string>('userId') || ''
    const authToken = config.get<string>('authToken') || ''
    const active = provider.getActiveProject()
    const activeWs = provider.getActiveWorkspace()

    if (userEmail || userId || authToken) {
      const emailShort = userEmail ? userEmail.split('@')[0] : 'Conectado'
      const projName = active ? active.name : 'Todos'
      statusBar.text = `$(check) Dev Flow: ${emailShort} | 📁 ${projName}`
      statusBar.tooltip = `Usuario: ${userEmail || userId || 'Conectado'}\nEspacio: ${activeWs ? activeWs.name : 'Todos'}\nProyecto: ${projName}\n\nHaz clic para opciones de Dev Flow.`
      statusBar.command = 'devflow.accountMenu'
    } else {
      statusBar.text = '$(account) Dev Flow: Conectar cuenta'
      statusBar.tooltip = 'Haz clic para conectar tu cuenta de Dev Flow'
      statusBar.command = 'devflow.connect'
    }
  }

  updateStatusBar()

  // Listener cuando cambian los datos del árbol
  provider.onDidChangeTreeData(() => {
    updateStatusBar()
  })

  // Comando: Conectar cuenta (Opciones profesionales: Navegador 1-clic, Token manual o Correo)
  const connectCmd = vscode.commands.registerCommand('devflow.connect', async () => {
    const config = vscode.workspace.getConfiguration('devflow')
    const webUrl = config.get<string>('webUrl') || 'https://dev-flow-7b197.web.app'

    const methods = [
      {
        label: '$(globe) Vincular en 1 Clic con el Navegador (Recomendado)',
        description: 'Abre Dev Flow en tu navegador para autenticarte de forma automática',
        action: 'browser',
      },
      {
        label: '$(key) Pegar Token de Acceso de Dev Flow',
        description: 'Generado desde Ajustes > Conexiones en la web de Dev Flow',
        action: 'token',
      },
      {
        label: '$(mail) Ingresar Correo Electrónico',
        description: 'Sincronizar mediante tu dirección de correo electrónico',
        action: 'email',
      },
    ]

    const selectedMethod = await vscode.window.showQuickPick(methods, {
      placeHolder: '¿Cómo deseas conectar tu cuenta de Dev Flow?',
    })

    if (!selectedMethod) return

    if (selectedMethod.action === 'browser') {
      const authUrl = `${webUrl}/?action=vscode-auth`
      vscode.env.openExternal(vscode.Uri.parse(authUrl))
      vscode.window.showInformationMessage(
        'Se abrió Dev Flow en tu navegador. Si ya iniciaste sesión, presiona "Vincular con VS Code".'
      )
    } else if (selectedMethod.action === 'token') {
      const token = await vscode.window.showInputBox({
        title: 'Token de Acceso de Dev Flow',
        prompt: 'Pega el token copiado desde Dev Flow Web (Ajustes > Conexiones > Extensión VS Code)',
        placeHolder: 'eyJhbGciOiJSUzI1NiIs...',
        password: true,
      })

      if (!token) return

      await config.update('authToken', token.trim(), vscode.ConfigurationTarget.Global)
      provider.workspaces = []
      provider.projects = []
      provider.refresh()
      vscode.window.showInformationMessage('¡Token de acceso guardado correctamente!')
    } else if (selectedMethod.action === 'email') {
      const currentEmail = config.get<string>('userEmail') || ''
      const email = await vscode.window.showInputBox({
        title: 'Conectar con Correo Electrónico',
        prompt: 'Ingresa tu correo registrado en Dev Flow',
        value: currentEmail,
        placeHolder: 'tu-correo@ejemplo.com',
        validateInput: (val) => {
          if (!val || !val.includes('@')) {
            return 'Por favor ingresa un correo electrónico válido'
          }
          return null
        },
      })

      if (!email) return

      await config.update('userEmail', email.trim(), vscode.ConfigurationTarget.Global)
      provider.workspaces = []
      provider.projects = []
      provider.refresh()
      vscode.window.showInformationMessage(`¡Cuenta configurada con el correo ${email.trim()}!`)
    }
  })
  context.subscriptions.push(connectCmd)

  // Comando: Seleccionar / Cambiar Espacio de Trabajo (Workspace)
  const selectWorkspaceCmd = vscode.commands.registerCommand('devflow.selectWorkspace', async () => {
    const config = vscode.workspace.getConfiguration('devflow')
    const userId = config.get<string>('userId') || ''
    const userEmail = config.get<string>('userEmail') || ''
    const authToken = config.get<string>('authToken') || ''

    if (!userId && !userEmail && !authToken) {
      vscode.commands.executeCommand('devflow.connect')
      return
    }

    if (provider.workspaces.length === 0) {
      provider.workspaces = await fetchUserWorkspaces(userId, userEmail, authToken)
    }

    interface WsQuickPickItem extends vscode.QuickPickItem {
      wsAction: 'all' | 'select'
      wsData?: DevFlowWorkspace
    }

    const items: WsQuickPickItem[] = []

    items.push({
      label: '$(globe) Todos los espacios de trabajo',
      description: 'Sin filtrar por área de trabajo',
      wsAction: 'all',
    })

    if (provider.workspaces.length > 0) {
      items.push({
        label: 'Tus Espacios de Trabajo',
        kind: vscode.QuickPickItemKind.Separator,
        wsAction: 'all',
      })

      for (const w of provider.workspaces) {
        const isCurrent = provider.activeWorkspace?.id === w.id
        items.push({
          label: `${isCurrent ? '✓ ' : ''}$(organization) ${w.name}`,
          wsAction: 'select',
          wsData: w,
        })
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Selecciona el espacio de trabajo a visualizar',
    })

    if (!selected) return

    if (selected.wsAction === 'all') {
      provider.setActiveWorkspace(null)
      vscode.window.showInformationMessage('Mostrando proyectos de todos los espacios.')
    } else if (selected.wsAction === 'select' && selected.wsData) {
      provider.setActiveWorkspace(selected.wsData)
      vscode.window.showInformationMessage(`🏢 Espacio activo: ${selected.wsData.name}`)
    }
  })
  context.subscriptions.push(selectWorkspaceCmd)

  // Comando: Seleccionar / Cambiar Proyecto
  const selectProjectCmd = vscode.commands.registerCommand('devflow.selectProject', async () => {
    const config = vscode.workspace.getConfiguration('devflow')
    const userId = config.get<string>('userId') || ''
    const userEmail = config.get<string>('userEmail') || ''
    const authToken = config.get<string>('authToken') || ''

    if (!userId && !userEmail && !authToken) {
      vscode.commands.executeCommand('devflow.connect')
      return
    }

    if (provider.projects.length === 0) {
      provider.projects = await fetchUserProjects(userId, userEmail, undefined, authToken)
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

    // Opción 3+: Proyectos (filtrados por espacio si hay uno activo)
    const availableProjects = provider.activeWorkspace
      ? provider.projects.filter(p => !p.workspaceId || p.workspaceId === provider.activeWorkspace?.id)
      : provider.projects

    if (availableProjects.length > 0) {
      items.push({
        label: provider.activeWorkspace ? `Proyectos en ${provider.activeWorkspace.name}` : 'Tus Proyectos en Dev Flow',
        kind: vscode.QuickPickItemKind.Separator,
        projectAction: 'all',
      })

      for (const p of availableProjects) {
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

  // Comando: Menú de opciones de cuenta
  const accountMenuCmd = vscode.commands.registerCommand('devflow.accountMenu', async () => {
    const config = vscode.workspace.getConfiguration('devflow')
    const email = config.get<string>('userEmail') || ''

    const options = [
      {
        label: '$(sync) Actualizar tablero de tickets',
        description: 'Recargar tareas en vivo desde Dev Flow',
        action: 'refresh',
      },
      {
        label: '$(organization) Cambiar espacio de trabajo',
        description: provider.activeWorkspace ? `Actual: ${provider.activeWorkspace.name}` : 'Todos los espacios',
        action: 'workspace',
      },
      {
        label: '$(folder) Cambiar proyecto activo',
        description: provider.activeProject ? `Actual: ${provider.activeProject.name}` : 'Todos los proyectos',
        action: 'project',
      },
      {
        label: '$(globe) Vincular o re-autenticar con Navegador',
        description: 'Iniciar sesión en dev->flow Web y transferir credenciales',
        action: 'browserLink',
      },
      {
        label: '$(sign-out) Desconectar cuenta / Cerrar sesión',
        description: 'Eliminar las credenciales locales de este editor',
        action: 'logout',
      },
    ]

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: email ? `Dev Flow • Conectado como ${email}` : 'Dev Flow • Opciones de cuenta',
    })

    if (!selected) return

    switch (selected.action) {
      case 'refresh':
        vscode.commands.executeCommand('devflow.refresh')
        break
      case 'workspace':
        vscode.commands.executeCommand('devflow.selectWorkspace')
        break
      case 'project':
        vscode.commands.executeCommand('devflow.selectProject')
        break
      case 'browserLink':
        vscode.commands.executeCommand('devflow.connect')
        break
      case 'logout':
        await config.update('authToken', '', vscode.ConfigurationTarget.Global)
        await config.update('userEmail', '', vscode.ConfigurationTarget.Global)
        await config.update('userId', '', vscode.ConfigurationTarget.Global)
        provider.workspaces = []
        provider.projects = []
        provider.setActiveWorkspace(null)
        provider.setActiveProject(null, false)
        vscode.window.showInformationMessage('Sesión cerrada de Dev Flow en este editor.')
        break
    }
  })
  context.subscriptions.push(accountMenuCmd)

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
        if (!gitExt.isActive) await gitExt.activate()
        const gitApi = gitExt.exports?.getAPI(1)
        const repo = gitApi?.repositories?.[0]
        if (repo) {
          await repo.createBranch(branchName, true)
          vscode.window.showInformationMessage(`🌿 Rama '${branchName}' creada y activada con éxito.`)
          return
        }
      } catch {}
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
