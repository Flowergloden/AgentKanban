import { readFile } from 'node:fs/promises';

export async function loadServiceMetadata(url = new URL('../service.json', import.meta.url)) {
  const metadata = JSON.parse(await readFile(url, 'utf8'));
  if (typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
    throw new Error('service.json: invalid version');
  }
  if (!Number.isSafeInteger(metadata.protocolVersion) || metadata.protocolVersion < 1) {
    throw new Error('service.json: invalid protocolVersion');
  }
  return Object.freeze({ version: metadata.version, protocolVersion: metadata.protocolVersion });
}
