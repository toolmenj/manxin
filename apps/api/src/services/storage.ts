/** 檔案存放（開發用本機磁碟）。TODO：正式環境換 S3 相容儲存（R2／MinIO）。 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

export interface Storage {
  put(key: string, data: Buffer): Promise<string>;
  read(storedPath: string): Readable;
}

export class LocalDiskStorage implements Storage {
  constructor(private readonly dir: string) {}
  async put(key: string, data: Buffer): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    const full = path.join(this.dir, safe);
    await writeFile(full, data);
    return safe;
  }
  read(storedPath: string): Readable {
    return createReadStream(path.join(this.dir, path.basename(storedPath)));
  }
}
