// Decode a browser-generated data URL into a PNG buffer.
// Returns null for anything that isn't a base64 image, so callers can skip
// instead of committing junk.

const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/;

export function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}
