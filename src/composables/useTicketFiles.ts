import { ref } from 'vue'
import { auth, db, storage } from '../firebase'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'

export interface TicketFile {
  name: string
  url: string
}

/** Límite máximo de tamaño por archivo: 10 MB (evita saturación de almacenamiento y costos imprevistos) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export function useTicketFiles() {
  const uploading = ref(false)

  function filesDocRef(ticketId: string) {
    return doc(db, 'tickets', ticketId, 'files', 'metadata')
  }

  async function getFiles(ticketId: string): Promise<TicketFile[]> {
    try {
      const snap = await getDoc(filesDocRef(ticketId))
      if (!snap.exists()) return []
      const data = snap.data()
      return data.files || []
    } catch {
      return []
    }
  }

  async function uploadFile(ticketId: string, file: File): Promise<TicketFile | null> {
    const user = auth.currentUser
    if (!user) return null

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`El archivo "${file.name}" supera el límite máximo permitido de 10 MB.`)
    }

    uploading.value = true
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const ref = storageRef(storage, `tickets/${ticketId}/${safeName}`)
      await uploadBytes(ref, file)
      const url = await getDownloadURL(ref)
      // Guardar metadata en Firestore
      const current = await getFiles(ticketId)
      current.push({ name: file.name, url })
      await setDoc(filesDocRef(ticketId), { files: current })
      return { name: file.name, url }
    } finally {
      uploading.value = false
    }
  }

  async function deleteFile(ticketId: string, fileName: string) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const ref = storageRef(storage, `tickets/${ticketId}/${safeName}`)
    await deleteObject(ref).catch(() => {})
    // Remover de Firestore
    const current = await getFiles(ticketId)
    const updated = current.filter((f) => f.name !== fileName)
    await setDoc(filesDocRef(ticketId), { files: updated })
  }

  return { getFiles, uploadFile, deleteFile, uploading, MAX_FILE_SIZE_BYTES }
}
