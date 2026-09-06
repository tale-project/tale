/**
 * "Has this cloud file changed since we mirrored it?" — the question both
 * import pipelines (OneDrive/SharePoint, Google Drive) ask before they
 * download. The vendor content hash answers it when present; Graph omits
 * `file.hashes` for some item types and in-flight uploads, and Drive omits
 * `md5Checksum` for non-binary items, and a file without a hash used to be
 * re-downloaded on EVERY scan (and, until the replacement bookkeeping was
 * fixed, strand a blob per scan). Without a hash the source's own
 * size + modified stamp stands in — the rsync posture: a content write
 * always moves the vendor's modified time.
 */

export interface SourceStamp {
  size?: number;
  /** Vendor-reported last-modified, ms since epoch. */
  modifiedAt?: number;
}

/** The hash-less change key stamped on the mirror's metadata
 * (`sourceFingerprint`); undefined when the vendor gave no usable stamp,
 * in which case the file is always re-downloaded, as before. */
export function sourceFingerprint(stamp: SourceStamp): string | undefined {
  if (
    stamp.size === undefined ||
    stamp.modifiedAt === undefined ||
    Number.isNaN(stamp.modifiedAt)
  ) {
    return undefined;
  }
  return `${stamp.size}:${stamp.modifiedAt}`;
}

/** Whether the mirror already holds the source's current content: by hash
 * when the vendor sent one, else by the stamped fingerprint. */
export function isSourceUnchanged(args: {
  hash: string | undefined;
  storedHash: string | undefined;
  fingerprint: string | undefined;
  storedFingerprint: unknown;
}): boolean {
  if (args.hash !== undefined && args.hash !== '') {
    return args.storedHash === args.hash;
  }
  return (
    args.fingerprint !== undefined &&
    args.storedFingerprint === args.fingerprint
  );
}
