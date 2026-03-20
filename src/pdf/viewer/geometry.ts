import type { PageViewport } from 'pdfjs-dist'
import type { PdfPointRect } from '../workspace/types'

export type ViewportRect = {
  x: number
  y: number
  width: number
  height: number
}

export function pdfRectToViewportRect(
  viewport: PageViewport,
  rect: PdfPointRect,
): ViewportRect {
  const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y + rect.height)
  const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y)

  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)

  return { x, y, width, height }
}

export function viewportRectToPdfRect(
  viewport: PageViewport,
  rect: ViewportRect,
): PdfPointRect {
  const [x1, y1] = viewport.convertToPdfPoint(rect.x, rect.y)
  const [x2, y2] = viewport.convertToPdfPoint(
    rect.x + rect.width,
    rect.y + rect.height,
  )

  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)

  return { x, y, width, height }
}

