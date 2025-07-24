
// utils.js

/**
 * Initializes the crypto object for generating UUIDs.
 * If the browser does not support `crypto.randomUUID`, it falls back to a custom implementation.
 * This is useful for generating unique identifiers in the application.
 */
export function initCrypto() {
  if (typeof window.crypto === 'undefined') window.crypto = {};
  if (!crypto.randomUUID) {
    crypto.randomUUID = function () {
      const bytes = new Uint8Array(16);
      if (crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        // extremely old browser – fallback to Math.random (lower entropy)
        for (let i = 0; i < 16; i++) bytes[i] = Math.random() * 256;
      }
      // set version / variant bits
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
  }
}