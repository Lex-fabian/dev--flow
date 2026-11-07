import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { DevFlowProject } from './api'

export function normalizeGitUrl(url: string): string {
  if (!url) return ''
  return url
    .trim()
    .toLowerCase()
    .replace(/^git@github\.com:/, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')
}

export async function getWorkspaceGitInfo(): Promise<{ remoteUrl: string; folderName: string }> {
  let remoteUrl = ''
  let folderName = ''

  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) {
    const rootPath = folders[0].uri.fsPath
    folderName = folders[0].name.toLowerCase()

    // 1. Lectura directa de .git/config (100% fiable, sin depender de extensiones externas)
    try {
      const gitConfigPath = path.join(rootPath, '.git', 'config')
      if (fs.existsSync(gitConfigPath)) {
        const content = fs.readFileSync(gitConfigPath, 'utf8')
        // Buscar remote "origin" o cualquier URL remota
        const originMatch = content.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*([^\r\n]+)/)
        if (originMatch) {
          remoteUrl = originMatch[1].trim()
        } else {
          const anyUrlMatch = content.match(/url\s*=\s*([^\r\n]+)/)
          if (anyUrlMatch) {
            remoteUrl = anyUrlMatch[1].trim()
          }
        }
      }
    } catch (err) {
      console.warn('No se pudo leer .git/config directamente:', err)
    }
  }

  // 2. Si no se detectó por archivo, consultar API de Git de VS Code
  if (!remoteUrl) {
    try {
      const gitExt = vscode.extensions.getExtension<any>('vscode.git')
      if (gitExt) {
        if (!gitExt.isActive) {
          await gitExt.activate()
        }
        const gitApi = gitExt.exports?.getAPI(1)
        const repo = gitApi?.repositories?.[0]
        if (repo) {
          const remotes = repo.state?.remotes || []
          const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0]
          if (origin?.fetchUrl || origin?.pushUrl) {
            remoteUrl = origin.fetchUrl || origin.pushUrl
          }
        }
      }
    } catch (err) {
      console.warn('Error consultando API de Git de VS Code:', err)
    }
  }

  return { remoteUrl, folderName }
}

export function autoDetectProject(projects: DevFlowProject[], remoteUrl: string, folderName: string): DevFlowProject | null {
  if (!projects || projects.length === 0) return null

  const normRemote = normalizeGitUrl(remoteUrl)

  // 1. Coincidencia exacta o parcial de repositorio GitHub
  if (normRemote) {
    const byRepo = projects.find(p => {
      if (!p.github) return false
      const normProjectGithub = normalizeGitUrl(p.github)
      return (
        normProjectGithub === normRemote ||
        normRemote.includes(normProjectGithub) ||
        normProjectGithub.includes(normRemote)
      )
    })
    if (byRepo) return byRepo
  }

  // 2. Coincidencia por nombre de carpeta en el espacio de trabajo
  if (folderName) {
    const cleanFolder = folderName.replace(/[^a-z0-9]/g, '')
    const byFolder = projects.find(p => {
      const cleanProjectName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      return (
        cleanProjectName === cleanFolder ||
        cleanProjectName.includes(cleanFolder) ||
        cleanFolder.includes(cleanProjectName)
      )
    })
    if (byFolder) return byFolder
  }

  return null
}
