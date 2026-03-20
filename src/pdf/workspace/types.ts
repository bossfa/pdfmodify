export type PdfProjectMode = 'fillable' | 'rebrand'

export type PdfPointRect = {
  x: number
  y: number
  width: number
  height: number
}

export type BaseElement = {
  id: string
  pageIndex: number
  rect: PdfPointRect
}

export type FillableFieldKind = 'text' | 'checkbox' | 'signature'

export type FillableFieldElement = BaseElement & {
  feature: 'fillable'
  kind: FillableFieldKind
  name: string
  required: boolean
  fontSize: number
  background: 'none' | 'white'
}

export type RebrandElement =
  | (BaseElement & {
      feature: 'rebrand'
      kind: 'text'
      value: string
      fontSize: number
      background: 'none' | 'white'
      asTemplateField: boolean
      fieldName: string
    })
  | (BaseElement & {
      feature: 'rebrand'
      kind: 'logo'
      imageBytes: Uint8Array
      imageMime: 'image/png' | 'image/jpeg'
      opacity: number
      background: 'none' | 'white'
    })

export type WorkspaceElement = FillableFieldElement | RebrandElement

export type PdfWorkspaceProject = {
  id: string
  fileName: string
  originalBytes: Uint8Array
  mode: PdfProjectMode
  elements: WorkspaceElement[]
  ui: {
    zoom: number
  }
}
