import * as vscode from 'vscode'
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
    folderName = folders[0].name.toLowerCase()
  }

  try {
    const gitExt = vscode.extensions.getExtension<any>('vscode.git')
    if (gitExt) {
      const gitApi = gitExt.exports.getAPI(1)
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
    console.error('Error obteniendo git remote:', err)
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
      return normProjectGithub === normRemote || normRemote.includes(normProjectGithub) || normProjectGithub.includes(normRemote)
    })
    if (byRepo) return byRepo
  }

  // 2. Coincidencia por nombre de carpeta en el espacio de trabajo
  if (folderName) {
    const byFolder = projects.find(p => {
      const pName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const fName = folderName.replace(/[^a-z0-9]/g, '')
      return pName === fName || pName.includes(fName) || fName.includes(pName)
    })
    if (byFolder) return byFolder
  }

  return null
}
