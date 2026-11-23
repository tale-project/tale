/**
 * An archive written by hand, for the tests of the readers: every field a
 * careless or a hostile writer could set is the caller's to set.
 */

import { crc32, deflateRawSync } from 'node:zlib';

export interface RawPart {
  /** The part's name in the directory at the archive's end. */
  readonly name: string | Uint8Array;
  /** Its name in its own header; the directory's unless given. */
  readonly ownName?: string | Uint8Array;
  readonly data: string | Uint8Array;
  /** Whether its names are flagged as UTF-8; they are unless said. */
  readonly utf8Flag?: boolean;
  /** The size the directory states for it, where that is to be a lie. */
  readonly statedSize?: number;
}

const bytesOf = (value: string | Uint8Array): Buffer =>
  typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);

/** A zip archive of `parts`, each deflated, in the order given. */
export function rawZip(parts: readonly RawPart[]): Uint8Array {
  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = bytesOf(part.name);
    const ownName = bytesOf(part.ownName ?? part.name);
    const data = bytesOf(part.data);
    const packed = deflateRawSync(data);
    const flags = part.utf8Flag === false ? 0 : 0x800;
    const checksum = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(ownName.length, 26);
    body.push(header, ownName, packed);

    const listed = Buffer.alloc(46);
    listed.writeUInt32LE(0x02014b50, 0);
    listed.writeUInt16LE(20, 4);
    listed.writeUInt16LE(20, 6);
    listed.writeUInt16LE(flags, 8);
    listed.writeUInt16LE(8, 10);
    listed.writeUInt16LE(0x21, 14);
    listed.writeUInt32LE(checksum, 16);
    listed.writeUInt32LE(packed.length, 20);
    listed.writeUInt32LE(part.statedSize ?? data.length, 24);
    listed.writeUInt16LE(name.length, 28);
    listed.writeUInt32LE(offset, 42);
    directory.push(listed, name);

    offset += header.length + ownName.length + packed.length;
  }
  const listing = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...body, listing, end]));
}
