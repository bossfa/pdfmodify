export async function readImageFile(file: File): Promise<{
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
}> {
  const mime = normalizeImageMime(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { bytes, mime }
}

function normalizeImageMime(file: File): 'image/png' | 'image/jpeg' {
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
    return 'image/png'
  }
  if (
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg' ||
    file.name.toLowerCase().endsWith('.jpg') ||
    file.name.toLowerCase().endsWith('.jpeg')
  ) {
    return 'image/jpeg'
  }
  throw new Error('Formato immagine non supportato. Usa PNG o JPG.')
}

