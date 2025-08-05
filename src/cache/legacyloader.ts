import * as path from "path";
import * as fs from "fs";
import { CacheFileSource, CacheIndex, CacheIndexFile, SubFile, DirectCacheFileSource } from "./index";
import { parseLegacyArchive } from "./legacycache";
import { lastLegacyBuildnr } from "../constants";
import { CS2OpcodeMappings, Build727ClientscriptObfuscation } from "./cs2opcodes";

/**
 * Handles the legacy RuneScape 2 cache format with main_file_cache.dat2 and main_file_cache.idx* files
 * This format was used roughly from 2004-2012 before the modern SQLite .jcache format
 */
export class LegacyFileSource extends DirectCacheFileSource {
    cachedir: string;
    timestamp = new Date();
    private datFile: string;
    private indexFiles = new Map<number, string>();
    private cs2Mappings: CS2OpcodeMappings | null = null;

    constructor(cachedir: string, cs2MappingFile?: string) {
        super(false); // doesn't require CRC
        this.cachedir = path.resolve(cachedir);
        this.datFile = path.resolve(cachedir, "main_file_cache.dat2");

        // Find all index files
        this.scanIndexFiles();

        // Load CS2 opcode mappings if provided
        if (cs2MappingFile) {
            this.loadCS2Mappings(cs2MappingFile);
        }
    }

    private scanIndexFiles() {
        try {
            const files = fs.readdirSync(this.cachedir);
            for (const file of files) {
                const match = file.match(/^main_file_cache\.idx(\d+)$/);
                if (match) {
                    const indexId = parseInt(match[1]);
                    this.indexFiles.set(indexId, path.resolve(this.cachedir, file));
                }
            }
            console.log(`Found ${this.indexFiles.size} index files in legacy cache`);
        } catch (e) {
            throw new Error(`Failed to scan legacy cache directory: ${this.cachedir}`);
        }
    }

    getCacheMeta() {
        return {
            name: `legacy:${this.cachedir}`,
            descr: `Legacy RuneScape 2 cache with .dat2/.idx format. Found ${this.indexFiles.size} index files.`,
            timestamp: this.timestamp
        }
    }

    private async loadCS2Mappings(filePath: string) {
        try {
            const fullPath = path.resolve(this.cachedir, filePath);
            this.cs2Mappings = await CS2OpcodeMappings.loadFromFile(fullPath);
            console.log(`Loaded CS2 opcode mappings from ${filePath}`);
        } catch (e) {
            console.warn(`Failed to load CS2 mappings from ${filePath}:`, e.message);
            this.cs2Mappings = null;
        }
    }

    getDecodeArgs(): Record<string, any> {
        const args = super.getDecodeArgs();

        // Provide CS2 deobfuscation if we have mappings loaded
        if (this.cs2Mappings) {
            args.clientScriptDeob = new Build727ClientscriptObfuscation(this.cs2Mappings);
        }

        return args;
    }

    async getFile(major: number, minor: number, crc?: number): Promise<Buffer> {
        // Check if we have the index file for this major
        const indexPath = this.indexFiles.get(major);
        if (!indexPath) {
            throw new Error(`Index file ${major} not found in legacy cache`);
        }

        try {
            // Read the index file to get file location in dat2
            const indexBuffer = await fs.promises.readFile(indexPath);
            const indexEntrySize = 6; // Each entry is 6 bytes: 3 bytes size + 3 bytes offset
            const entryOffset = minor * indexEntrySize;

            if (entryOffset + indexEntrySize > indexBuffer.length) {
                throw new Error(`File ${major}.${minor} not found in index`);
            }

            // Read the index entry (3 bytes size + 3 bytes offset)
            const size = indexBuffer.readUIntBE(entryOffset, 3);
            const offset = indexBuffer.readUIntBE(entryOffset + 3, 3);

            if (size === 0) {
                throw new Error(`File ${major}.${minor} has zero size`);
            }

            // Read the file data from main_file_cache.dat2
            const fileHandle = await fs.promises.open(this.datFile, 'r');
            try {
                const buffer = Buffer.alloc(size);
                const { bytesRead } = await fileHandle.read(buffer, 0, size, offset);

                if (bytesRead !== size) {
                    throw new Error(`Expected to read ${size} bytes but got ${bytesRead}`);
                }

                return buffer;
            } finally {
                await fileHandle.close();
            }
        } catch (e) {
            throw new Error(`Failed to read file ${major}.${minor}: ${e.message}`);
        }
    }

    async getFileArchive(index: CacheIndex): Promise<SubFile[]> {
        const file = await this.getFile(index.major, index.minor, index.crc);

        // Use the legacy archive parser for files that might be archived
        // For build 727, major 0 typically contains archived files
        if (index.major === 0) {
            return parseLegacyArchive(file, index.major, false);
        } else {
            // For other majors, return as single file
            return [{
                buffer: file,
                fileid: 0,
                namehash: null,
                offset: 0,
                size: file.byteLength
            }];
        }
    }

    async getCacheIndex(major: number): Promise<CacheIndexFile> {
        const indexPath = this.indexFiles.get(major);
        if (!indexPath) {
            throw new Error(`Index file ${major} not found`);
        }

        try {
            const indexBuffer = await fs.promises.readFile(indexPath);
            const indexEntrySize = 6;
            const numEntries = Math.floor(indexBuffer.length / indexEntrySize);

            const indices: CacheIndex[] = [];

            for (let minor = 0; minor < numEntries; minor++) {
                const entryOffset = minor * indexEntrySize;
                const size = indexBuffer.readUIntBE(entryOffset, 3);

                // Only create index entries for files that exist (size > 0)
                if (size > 0) {
                    indices[minor] = {
                        major,
                        minor,
                        crc: 0, // Legacy format doesn't store CRCs in index
                        version: 0,
                        size,
                        name: null,
                        subindexcount: 1,
                        subindices: [0],
                        subnames: null,
                        uncompressed_crc: 0,
                        uncompressed_size: size
                    };
                }
            }

            return indices;
        } catch (e) {
            throw new Error(`Failed to read index ${major}: ${e.message}`);
        }
    }

    getBuildNr() {
        return 727; // Use the correct build number now that we have proper opcode mappings
    }

    /**
     * Get available major indices (index file numbers)
     */
    getAvailableMajors(): number[] {
        return Array.from(this.indexFiles.keys()).sort((a, b) => a - b);
    }

    /**
     * Check if a specific major index exists
     */
    hasMajor(major: number): boolean {
        return this.indexFiles.has(major);
    }
}