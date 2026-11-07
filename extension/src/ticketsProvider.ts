import * as vscode from 'vscode'
import {
  DevFlowTicket,
  DevFlowProject,
  DevFlowWorkspace,
  fetchUserTickets,
  fetchUserProjects,
  fetchUserWorkspaces,
} from './api'
import { getWorkspaceGitInfo, autoDetectProject } from './gitHelper'

export class UserAccountHeaderItem extends vscode.TreeItem {
  constructor(public readonly email: string, public readonly userId: string, public readonly hasToken: boolean) {
    const isConnected = Boolean(hasToken || email || userId)
    const title = isConnected ? `Cuenta: ${email || 'Conectado'}` : 'Conectar con Dev Flow...'
    super(title, vscode.TreeItemCollapsibleState.None)

    if (isConnected) {
      this.description = '✓ En línea'
      this.tooltip = `Conectado a Dev Flow:\nUsuario: ${email || 'UID: ' + userId}\n\nHaz clic para opciones de cuenta (cerrar sesión, cambiar usuario, abrir web).`
      this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'))
      this.contextValue = 'userAccount'
      this.command = {
        command: 'devflow.accountMenu',
        title: 'Opciones de Cuenta',
      }
    } else {
      this.description = 'Clic para iniciar'
      this.tooltip = 'No estás conectado a Dev Flow.\nHaz clic aquí para vincular tu cuenta con 1 clic en el navegador o ingresar tu token.'
      this.iconPath = new vscode.ThemeIcon('account')
      this.contextValue = 'userLogin'
      this.command = {
        command: 'devflow.connect',
        title: 'Conectar cuenta',
      }
    }
  }
}

export class WorkspaceHeaderItem extends vscode.TreeItem {
  constructor(public readonly workspace: DevFlowWorkspace | null, public readonly totalProjects: number) {
    const title = workspace ? `Espacio: ${workspace.name}` : 'Espacio: Todos los espacios'
    super(title, vscode.TreeItemCollapsibleState.None)

    this.description = workspace ? `(${totalProjects} proyectos)` : '(Sin filtro)'
    this.tooltip = workspace
      ? `Área de trabajo: ${workspace.name}\nProyectos disponibles: ${totalProjects}\n\nHaz clic para cambiar de espacio de trabajo.`
      : 'Mostrando proyectos de todas tus áreas de trabajo.\n\nHaz clic para filtrar por un espacio específico.'

    this.iconPath = new vscode.ThemeIcon('organization')
    this.contextValue = 'workspaceHeader'
    this.command = {
      command: 'devflow.selectWorkspace',
      title: 'Cambiar espacio de trabajo',
    }
  }
}

export class ProjectHeaderItem extends vscode.TreeItem {
  constructor(
    public readonly project: DevFlowProject | null,
    public readonly isAuto: boolean,
    public readonly totalTickets: number
  ) {
    const title = project ? `Proyecto: ${project.name}` : 'Proyecto: Todos los proyectos'
    super(title, vscode.TreeItemCollapsibleState.None)

    this.description = isAuto ? '✨ Auto-vinculado por Git' : project ? '(Filtro activo)' : '(Sin filtro)'
    this.tooltip = project
      ? `Proyecto: ${project.name}\nGitHub: ${project.github || 'No vinculado'}\nTickets activos: ${totalTickets}\n\nHaz clic para cambiar de proyecto.`
      : 'Mostrando tickets de todos tus proyectos.\n\nHaz clic para filtrar por un proyecto específico.'

    this.iconPath = new vscode.ThemeIcon(project ? 'folder-active' : 'project')
    this.contextValue = 'projectHeader'
    this.command = {
      command: 'devflow.selectProject',
      title: 'Cambiar de proyecto',
    }
  }
}

export class TicketItem extends vscode.TreeItem {
  constructor(
    public readonly ticket: DevFlowTicket,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    const code = `DF-${ticket.id.slice(0, 4)}`
    super(`${code}: ${ticket.title}`, collapsibleState)

    const priorityBadge = {
      urgent: '🔴 Urgente',
      high: '🟠 Alta',
      medium: '🟡 Media',
      low: '🟢 Baja',
    }[ticket.priority] || '🟡 Media'

    const branchBadge = ticket.gitBranch ? `🌿 ${ticket.gitBranch}` : ''
    this.description = [priorityBadge, branchBadge].filter(Boolean).join(' • ')

    const md = new vscode.MarkdownString()
    md.isTrusted = true
    md.appendMarkdown(`### [${code}] ${ticket.title}\n\n`)
    md.appendMarkdown(`---\n\n`)
    md.appendMarkdown(`- **Estado:** ${ticket.status}\n`)
    md.appendMarkdown(`- **Prioridad:** ${priorityBadge}\n`)
    if (ticket.gitBranch) {
      md.appendMarkdown(`- **Rama Git:** \`${ticket.gitBranch}\`\n`)
    }
    if (ticket.assignedToEmail) {
      md.appendMarkdown(`- **Asignado a:** ${ticket.assignedToEmail}\n`)
    }
    if (ticket.description) {
      md.appendMarkdown(`\n> ${ticket.description}\n\n`)
    }
    md.appendMarkdown(`---\n\n*💡 Clic para ver opciones o usa los iconos de la derecha.*`)
    this.tooltip = md

    this.contextValue = 'ticket'

    // Icon according to status
    switch (ticket.status) {
      case 'en-proceso':
        this.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow'))
        break
      case 'testing':
        this.iconPath = new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.purple'))
        break
      case 'completado':
        this.iconPath = new vscode.ThemeIcon('check-circle', new vscode.ThemeColor('charts.green'))
        break
      default:
        this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.foreground'))
        break
    }

    this.command = {
      command: 'devflow.ticketDetails',
      title: 'Detalles del Ticket',
      arguments: [this],
    }
  }
}

export class StatusGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly status: string,
    public readonly count: number,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(`${label} (${count})`, collapsibleState)
    this.contextValue = 'statusGroup'

    switch (status) {
      case 'en-proceso':
        this.iconPath = new vscode.ThemeIcon('sync')
        break
      case 'testing':
        this.iconPath = new vscode.ThemeIcon('pulse')
        break
      case 'completado':
        this.iconPath = new vscode.ThemeIcon('pass-filled')
        break
      default:
        this.iconPath = new vscode.ThemeIcon('inbox')
        break
    }
  }
}

export class TicketsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>()
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event

  private tickets: DevFlowTicket[] = []
  public workspaces: DevFlowWorkspace[] = []
  public projects: DevFlowProject[] = []
  public activeWorkspace: DevFlowWorkspace | null = null
  public activeProject: DevFlowProject | null = null
  public isAutoDetected: boolean = false

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getActiveProject(): DevFlowProject | null {
    return this.activeProject
  }

  getActiveWorkspace(): DevFlowWorkspace | null {
    return this.activeWorkspace
  }

  setActiveWorkspace(ws: DevFlowWorkspace | null): void {
    this.activeWorkspace = ws
    // Si el proyecto actual no pertenece a este espacio, reiniciar selección de proyecto
    if (ws && this.activeProject && this.activeProject.workspaceId && this.activeProject.workspaceId !== ws.id) {
      this.activeProject = null
      this.isAutoDetected = false
    }
    this.refresh()
  }

  setActiveProject(project: DevFlowProject | null, isAuto = false): void {
    this.activeProject = project
    this.isAutoDetected = isAuto
    // Auto-ajustar espacio si el proyecto tiene uno
    if (project?.workspaceId && this.workspaces.length > 0) {
      const matchWs = this.workspaces.find(w => w.id === project.workspaceId)
      if (matchWs) {
        this.activeWorkspace = matchWs
      }
    }
    this.refresh()
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const config = vscode.workspace.getConfiguration('devflow')
    const userId = config.get<string>('userId') || ''
    const userEmail = config.get<string>('userEmail') || ''
    const authToken = config.get<string>('authToken') || ''

    if (!element) {
      const accountItem = new UserAccountHeaderItem(userEmail, userId, Boolean(authToken))

      // Si no hay ningún dato de sesión configurado, mostrar solo tarjeta para conectar
      if (!userId && !userEmail && !authToken) {
        return [accountItem]
      }

      // 1. Cargar áreas de trabajo
      if (this.workspaces.length === 0) {
        this.workspaces = await fetchUserWorkspaces(userId, userEmail, authToken)
      }

      // 2. Cargar proyectos
      if (this.projects.length === 0) {
        this.projects = await fetchUserProjects(userId, userEmail, undefined, authToken)
      }

      // 3. Si no hay proyecto seleccionado, auto-detectar por Git (.git/config)
      if (!this.activeProject && this.projects.length > 0) {
        const { remoteUrl, folderName } = await getWorkspaceGitInfo()
        const detected = autoDetectProject(this.projects, remoteUrl, folderName)
        if (detected) {
          this.activeProject = detected
          this.isAutoDetected = true
          if (detected.workspaceId && this.workspaces.length > 0) {
            this.activeWorkspace = this.workspaces.find(w => w.id === detected.workspaceId) || null
          }
        }
      }

      // 4. Filtrar proyectos disponibles según espacio de trabajo
      const visibleProjects = this.activeWorkspace
        ? this.projects.filter(p => !p.workspaceId || p.workspaceId === this.activeWorkspace?.id)
        : this.projects

      // 5. Consultar tickets
      const targetProjectId = this.activeProject ? this.activeProject.id : undefined
      const { tickets, resolvedUid } = await fetchUserTickets(userId, userEmail, targetProjectId, authToken)
      this.tickets = tickets

      if (resolvedUid && !userId) {
        await config.update('userId', resolvedUid, vscode.ConfigurationTarget.Global)
      }

      const inProgress = this.tickets.filter(t => t.status === 'en-proceso')
      const todo = this.tickets.filter(t => t.status === 'sin-realizar')
      const testing = this.tickets.filter(t => t.status === 'testing')
      const done = this.tickets.filter(t => t.status === 'completado')

      const workspaceHeader = new WorkspaceHeaderItem(this.activeWorkspace, visibleProjects.length)
      const projectHeader = new ProjectHeaderItem(this.activeProject, this.isAutoDetected, this.tickets.length)

      return [
        accountItem,
        workspaceHeader,
        projectHeader,
        new StatusGroupItem('En proceso', 'en-proceso', inProgress.length, vscode.TreeItemCollapsibleState.Expanded),
        new StatusGroupItem('Sin realizar', 'sin-realizar', todo.length, vscode.TreeItemCollapsibleState.Expanded),
        new StatusGroupItem('Testing', 'testing', testing.length, vscode.TreeItemCollapsibleState.Collapsed),
        new StatusGroupItem('Completado', 'completado', done.length, vscode.TreeItemCollapsibleState.Collapsed),
      ]
    }

    if (element instanceof StatusGroupItem) {
      const filtered = this.tickets.filter(t => t.status === element.status)
      if (filtered.length === 0) {
        const emptyItem = new vscode.TreeItem('No hay tickets en esta columna')
        emptyItem.iconPath = new vscode.ThemeIcon('info')
        return [emptyItem]
      }
      return filtered.map(t => new TicketItem(t))
    }

    return []
  }
}
