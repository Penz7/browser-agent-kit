// Chrome derives the id of an unpacked extension from its folder path: the first 32 hex chars of SHA-256 over the
// path bytes, each hex digit mapped to a-p. On Windows the path is lower-cased and hashed as UTF-16LE.
import { createHash } from 'node:crypto';

export function extensionIdForPath(folder, platform = process.platform) {
  const bytes = platform === 'win32' ? Buffer.from(folder.toLowerCase(), 'utf16le') : Buffer.from(folder, 'utf8');
  const hex = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return Array.from(hex, (c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
