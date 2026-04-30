import fs from 'fs';
import path from 'path';

/**
 * SharedJsonFileStore — atomic JSON file read/write utility.
 *
 * Writes via a temp file + rename so concurrent readers never see a partial write.
 * Corrupt files return `null` from read (caller decides on fallback).
 */
export interface JsonFileStore<T> {
  read(): T | null;
  write(data: T): void;
}

export function createJsonFileStore<T>(filePath: string): JsonFileStore<T> {
  return {
    read(): T | null {
      if (!fs.existsSync(filePath)) return null;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },

    write(data: T): void {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, filePath);
    },
  };
}
