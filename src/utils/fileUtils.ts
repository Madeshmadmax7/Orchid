// ============================================================================
// Project Memory — File Utilities
// ============================================================================

import * as crypto from 'crypto';

/**
 * Computes SHA-256 hash of file content for change detection.
 */
export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Converts an absolute path to a safe filename for storage.
 * Replaces path separators and special chars with underscores.
 */
export function pathToStorageKey(relativePath: string): string {
  return relativePath
    .replace(/[/\\]/g, '__')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Normalizes a file path to use forward slashes.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Extracts the file name without extension.
 */
export function fileBaseName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1];
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

/**
 * Counts lines of code in content (non-empty lines).
 */
export function countLinesOfCode(content: string): number {
  const lines = content.split('\n');
  return lines.filter((line) => line.trim().length > 0).length;
}
