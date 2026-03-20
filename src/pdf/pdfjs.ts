import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let isWorkerConfigured = false

export type { PDFDocumentProxy, PDFPageProxy }

export function configurePdfJsWorker(): void {
  if (isWorkerConfigured) return
  isWorkerConfigured = true
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
}

export async function loadPdfDocument(
  bytes: Uint8Array,
  opts?: { password?: string },
): Promise<PDFDocumentProxy> {
  configurePdfJsWorker()
  const load = async (disableWorker: boolean) => {
    const data = new Uint8Array(bytes)
    const task = pdfjs.getDocument(({
      data,
      password: opts?.password,
      cMapPacked: true,
      useSystemFonts: true,
      disableAutoFetch: false,
      disableWorker,
    } as unknown) as Parameters<typeof pdfjs.getDocument>[0])
    return await task.promise
  }

  try {
    return await load(false)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/detached/i.test(message) || /postMessage/i.test(message)) {
      return await load(true)
    }
    throw e
  }
}
