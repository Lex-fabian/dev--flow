import * as vscode from 'vscode'
import { DevFlowTicket, fetchUserTickets } from './api'

export class TicketItem extends vscode.TreeItem {
  constructor(
    public readonly ticket: DevFlowTicket,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(ticket.title, collapsibleState)

    const code = `DF-${ticket.id.slice(0, 4)}`
    this.description = `${code} [${ticket.priority}]`
    this.tooltip = `${ticket.title}\nPrioridad: ${ticket.priority}\nEstado: ${ticket.status}\nProyecto: ${ticket.projectId}`
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

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const config = vscode.workspace.getConfiguration('devflow')
    const userId = config.get<string>('userId') || ''
    const userEmail = config.get<string>('userEmail') || ''

    if (!userId && !userEmail) {
      const connectItem = new vscode.TreeItem('Conectar cuenta de dev->flow...')
      connectItem.command = {
        command: 'devflow.connect',
        title: 'Conectar cuenta',
      }
      connectItem.iconPath = new vscode.ThemeIcon('account')
      return [connectItem]
    }

    if (!element) {
      // Root: fetch all tickets and group by status
      this.tickets = await fetchUserTickets(userId, userEmail)

      const inProgress = this.tickets.filter(t => t.status === 'en-proceso')
      const todo = this.tickets.filter(t => t.status === 'sin-realizar')
      const testing = this.tickets.filter(t => t.status === 'testing')
      const done = this.tickets.filter(t => t.status === 'completado')

      return [
        new StatusGroupItem('En proceso', 'en-proceso', inProgress.length, vscode.TreeItemCollapsibleState.Expanded),
        new StatusGroupItem('Sin realizar', 'sin-realizar', todo.length, vscode.TreeItemCollapsibleState.Expanded),
        new StatusGroupItem('Testing', 'testing', testing.length, vscode.TreeItemCollapsibleState.Collapsed),
        new StatusGroupItem('Completado', 'completado', done.length, vscode.TreeItemCollapsibleState.Collapsed),
      ]
    }

    if (element instanceof StatusGroupItem) {
      const filtered = this.tickets.filter(t => t.status === element.status)
      return filtered.map(t => new TicketItem(t))
    }

    return []
  }
}

