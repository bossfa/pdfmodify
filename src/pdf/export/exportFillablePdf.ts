import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { FillableFieldElement } from '../workspace/types'

export async function exportFillablePdf(
  originalBytes: Uint8Array,
  elements: FillableFieldElement[],
): Promise<Uint8Array> {
  const bytes =
    originalBytes.byteOffset === 0 &&
    originalBytes.byteLength === originalBytes.buffer.byteLength
      ? originalBytes
      : new Uint8Array(originalBytes)
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdfDoc.getForm()
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const usedNames = new Set<string>()

  for (const el of elements) {
    const page = pdfDoc.getPage(el.pageIndex)
    const name = ensureUniqueFieldName(sanitizeFieldName(el.name), usedNames)
    const widgetBg =
      el.background === 'white' && shouldApplyWhiteBackground(el, page)
        ? rgb(1, 1, 1)
        : undefined

    if (el.kind === 'text') {
      const field = form.createTextField(name)
      if (el.required) field.enableRequired()
      field.addToPage(page, {
        x: el.rect.x,
        y: el.rect.y,
        width: el.rect.width,
        height: el.rect.height,
        font: helvetica,
        borderWidth: 0,
        ...(widgetBg ? { backgroundColor: widgetBg } : {}),
      })
      setTextDefaultAppearance(field, helvetica.name, el.fontSize)
      try {
        field.updateAppearances(helvetica)
      } catch {
        void 0
      }
      continue
    }

    if (el.kind === 'checkbox') {
      const field = form.createCheckBox(name)
      if (el.required) field.enableRequired()
      field.addToPage(page, {
        x: el.rect.x,
        y: el.rect.y,
        width: el.rect.width,
        height: el.rect.height,
        borderWidth: 0,
        ...(widgetBg ? { backgroundColor: widgetBg } : {}),
      })
      continue
    }

    const field = form.createTextField(name)
    if (el.required) field.enableRequired()
    field.addToPage(page, {
      x: el.rect.x,
      y: el.rect.y,
      width: el.rect.width,
      height: el.rect.height,
      font: helvetica,
      borderWidth: 0,
      ...(widgetBg ? { backgroundColor: widgetBg } : {}),
    })
    setTextDefaultAppearance(field, helvetica.name, el.fontSize)
    try {
      field.updateAppearances(helvetica)
    } catch {
      void 0
    }
  }

  try {
    form.updateFieldAppearances(helvetica)
  } catch {
    void 0
  }
  return await pdfDoc.save({ updateFieldAppearances: true })
}

function shouldApplyWhiteBackground(
  el: FillableFieldElement,
  page: { getWidth(): number; getHeight(): number },
): boolean {
  const pageArea = page.getWidth() * page.getHeight()
  const area = el.rect.width * el.rect.height
  if (!Number.isFinite(pageArea) || pageArea <= 0) return false
  if (!Number.isFinite(area) || area <= 0) return false
  if (area / pageArea > 0.08) return false
  if (el.rect.width > 520) return false
  if (el.rect.height > 60) return false
  return true
}

function sanitizeFieldName(input: string): string {
  const trimmed = input.trim() || 'field'
  const normalized = trimmed.replace(/\s+/g, '_')
  const safe = normalized.replace(/[^a-zA-Z0-9_.-]/g, '_')
  return safe.length > 64 ? safe.slice(0, 64) : safe
}

function setTextDefaultAppearance(
  field: { acroField: { setDefaultAppearance(appearance: string): void } },
  fontName: string,
  fontSize: number,
): void {
  const safeFontName = fontName.replace(/^\//, '') || 'Helv'
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12
  field.acroField.setDefaultAppearance(
    `0 0 0 rg\n/${safeFontName} ${safeFontSize} Tf`,
  )
}

function ensureUniqueFieldName(base: string, used: Set<string>): string {
  let name = base
  let i = 1
  while (used.has(name)) {
    i += 1
    name = `${base}_${i}`
  }
  used.add(name)
  return name
}
