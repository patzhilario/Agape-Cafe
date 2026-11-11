export async function validatePaymentReceipt(file) {
  if (!file || file.type !== 'image/jpeg' || !/\.jpe?g$/i.test(file.name)) {
    throw new Error('Upload a JPEG (.jpg or .jpeg) payment receipt only.')
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('The payment receipt must be 10 MB or smaller.')
  }
  const header = new Uint8Array(await file.slice(0, 3).arrayBuffer())
  if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
    throw new Error('This file is not a valid JPEG image. Upload the original JPEG receipt.')
  }
}
