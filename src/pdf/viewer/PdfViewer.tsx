import { useMemo } from 'react'
import type { PDFDocumentProxy } from '../pdfjs'
import type { WorkspaceElement } from '../workspace/types'
import { PageView } from './PageView'

type Props = {
  pdfDoc: PDFDocumentProxy
  zoom: number
  elements: WorkspaceElement[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onElementChange: (id: string, patch: Partial<WorkspaceElement>) => void
  onElementDelete: (id: string) => void
  onElementDuplicate: (id: string) => void
  drawKind: 'text' | 'checkbox' | 'signature' | null
  onCreateElement: (
    pageIndex: number,
    kind: 'text' | 'checkbox' | 'signature',
    rect: { x: number; y: number; width: number; height: number },
  ) => void
}

export function PdfViewer({
  pdfDoc,
  zoom,
  elements,
  selectedId,
  onSelect,
  onElementChange,
  onElementDelete,
  onElementDuplicate,
  drawKind,
  onCreateElement,
}: Props) {
  const pages = useMemo(() => {
    return Array.from({ length: pdfDoc.numPages }, (_, idx) => idx)
  }, [pdfDoc.numPages])

  return (
    <div className="pdfViewer" onMouseDown={() => onSelect(null)}>
      {pages.map((pageIndex) => (
        <PageView
          key={pageIndex}
          pdfDoc={pdfDoc}
          pageIndex={pageIndex}
          zoom={zoom}
          elements={elements.filter((e) => e.pageIndex === pageIndex)}
          selectedId={selectedId}
          onSelect={onSelect}
          onElementChange={onElementChange}
          onElementDelete={onElementDelete}
          onElementDuplicate={onElementDuplicate}
          drawKind={drawKind}
          onCreateElement={onCreateElement}
        />
      ))}
    </div>
  )
}
