import { ref } from 'vue'
import { auth, storage } from '../firebase'
import { ref as storageRef, uploadBytes, getDownloadURL, listAll } from 'firebase/storage'

const avatarUrl = ref('')

/** Límite máximo para foto de perfil: 2 MB */
export const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024

export function useAvatar() {
  async function loadAvatar() {
    const user = auth.currentUser
    if (!user) return
    try {
      const folderRef = storageRef(storage, `avatars/${user.uid}/`)
      const result = await listAll(folderRef)
      if (result.items.length > 0) {
        avatarUrl.value = await getDownloadURL(result.items[0])
      }
    } catch { /* no avatar yet */ }
  }

  async function uploadAvatar(file: File) {
    const user = auth.currentUser
    if (!user) return

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      throw new Error('La imagen de perfil no debe superar los 2 MB.')
    }
    if (!file.type.startsWith('image/')) {
      throw new Error('El archivo seleccionado debe ser una imagen válida.')
    }

    const ref = storageRef(storage, `avatars/${user.uid}/photo.jpg`)
    await uploadBytes(ref, file)
    avatarUrl.value = await getDownloadURL(ref)
  }

  return { avatarUrl, loadAvatar, uploadAvatar, MAX_AVATAR_SIZE_BYTES }
}
