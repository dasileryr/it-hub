/** Форматирует дату в человекочитаемый вид. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(sameDay ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d)
}

/** Инициалы для аватара. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

export function displayName(profile: { full_name?: string } | null | undefined): string {
  const n = profile?.full_name?.trim()
  return n && n.length > 0 ? n : 'Без имени'
}

/**
 * Уменьшает изображение до разумного размера перед загрузкой,
 * чтобы экономить место в хранилище. Не изображения и GIF не трогает.
 */
export function resizeImage(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<Blob> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
      resolve(file)
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      if (scale >= 1) {
        URL.revokeObjectURL(url)
        resolve(file)
        return
      }
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => resolve(blob ?? file),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}
