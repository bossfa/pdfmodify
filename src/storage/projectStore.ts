import { openDB } from 'idb'
import type { PdfWorkspaceProject } from '../pdf/workspace/types'

type StoredProject = {
  id: string
  updatedAt: number
  project: PdfWorkspaceProject
}

const DB_NAME = 'smartpdf-editor'
const DB_VERSION = 1
const STORE = 'projects'

async function getDb() {
  return await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    },
  })
}

export const projectStore = {
  async save(project: PdfWorkspaceProject): Promise<void> {
    const db = await getDb()
    const record: StoredProject = {
      id: project.id,
      updatedAt: Date.now(),
      project,
    }
    await db.put(STORE, record)
  },

  async getLast(): Promise<PdfWorkspaceProject | null> {
    const db = await getDb()
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.store.index('updatedAt')

    const cursor = await index.openCursor(null, 'prev')
    if (!cursor) return null
    const value = cursor.value as StoredProject
    return value.project
  },
}
