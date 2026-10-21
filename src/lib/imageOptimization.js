const MAX_SOURCE_SIZE = 20 * 1024 * 1024
const MAX_OUTPUT_SIZE = 600 * 1024
const MAX_DIMENSION = 1200
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('The image could not be encoded. Try another image.'))
      },
      'image/webp',
      quality,
    )
  })
}

export async function optimizeProductImage(file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.')
  }
  if (file.size > MAX_SOURCE_SIZE) {
    throw new Error('Choose an image smaller than 20 MB.')
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot resize images. Try a current version of Chrome, Edge, Firefox, or Safari.')
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    let scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The image could not be prepared for upload.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.82, 0.72, 0.62]) {
        const optimized = await canvasBlob(canvas, quality)
        if (optimized.size <= MAX_OUTPUT_SIZE) return optimized
      }
      scale *= 0.75
    }
  } finally {
    bitmap.close()
  }

  throw new Error('This image could not be reduced to 600 KB. Choose a smaller image.')
}
