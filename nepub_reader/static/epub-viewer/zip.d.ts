/**
 * Minimal read-only ZIP reader for EPUB archives.
 * Supports "stored" and "deflate" entries (no ZIP64, no encryption).
 * Entries are read lazily from the Blob, so large files are not loaded into memory at once.
 */
export declare class ZipReader {
    #private;
    private constructor();
    static open(blob: Blob): Promise<ZipReader>;
    has(name: string): boolean;
    /** Uncompressed size in bytes (0 if not found). */
    size(name: string): number;
    read(name: string, type?: string): Promise<Blob>;
}
