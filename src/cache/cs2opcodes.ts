import * as fs from "fs";
import * as path from "path";

export type CS2OpcodeMapping = {
    opcode: number;
    name: string;
    returnType: string;
    paramTypes: string[];
};

export class CS2OpcodeMappings {
    private mappings = new Map<number, CS2OpcodeMapping>();
    private nameToOpcode = new Map<string, number>();

    static async loadFromFile(filePath: string): Promise<CS2OpcodeMappings> {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return CS2OpcodeMappings.parseFromString(content);
    }

    static parseFromString(content: string): CS2OpcodeMappings {
        const loader = new CS2OpcodeMappings();
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
                continue; // Skip empty lines and comments
            }

            const parts = trimmed.split(/\s+/);
            if (parts.length < 3) {
                continue; // Invalid line format
            }

            const opcode = parseInt(parts[0]);
            const name = parts[1];
            const returnType = parts[2];
            const paramTypes = parts.slice(3);

            if (isNaN(opcode)) {
                continue; // Invalid opcode
            }

            const mapping: CS2OpcodeMapping = {
                opcode,
                name,
                returnType,
                paramTypes
            };

            loader.mappings.set(opcode, mapping);
            loader.nameToOpcode.set(name, opcode);
        }

        console.log(`Loaded ${loader.mappings.size} CS2 opcode mappings`);
        return loader;
    }

    getMapping(opcode: number): CS2OpcodeMapping | undefined {
        return this.mappings.get(opcode);
    }

    getOpcodeByName(name: string): number | undefined {
        return this.nameToOpcode.get(name);
    }

    getAllMappings(): CS2OpcodeMapping[] {
        return Array.from(this.mappings.values());
    }

    hasOpcode(opcode: number): boolean {
        return this.mappings.has(opcode);
    }
}

/**
 * Simple ClientScript obfuscation handler for build 727
 * This integrates with the existing scriptopt parser system
 */
export class Build727ClientscriptObfuscation {
    private mappings: CS2OpcodeMappings;

    constructor(mappings: CS2OpcodeMappings) {
        this.mappings = mappings;
    }

    readOpcode(state: any) {
        // Read the raw opcode from the stream
        const rawOpcode = state.buffer.readUInt16BE(state.scan);
        state.scan += 2;

        // Get the mapping for this opcode
        const mapping = this.mappings.getMapping(rawOpcode);

        if (!mapping) {
            console.warn(`Unknown CS2 opcode: ${rawOpcode} (0x${rawOpcode.toString(16)})`);
            return {
                opcode: rawOpcode,
                imm: 0,
                imm_obj: null,
                name: `unknown_${rawOpcode}`,
                returnType: 'unknown',
                paramTypes: []
            };
        }

        // For build 727, opcodes might have immediate values
        // This is a simplified implementation - you may need to adjust based on actual format
        let imm = 0;
        let imm_obj: any = null;

        // Some opcodes have immediate integer values
        if (mapping.paramTypes.length > 0) {
            const firstParam = mapping.paramTypes[0];
            if (firstParam === 'int' || firstParam === 'component') {
                imm = state.buffer.readInt32BE(state.scan);
                state.scan += 4;
                imm_obj = imm;
            } else if (firstParam === 'string') {
                // Read null-terminated string
                const stringStart = state.scan;
                while (state.scan < state.endoffset && state.buffer[state.scan] !== 0) {
                    state.scan++;
                }
                imm_obj = state.buffer.toString('utf8', stringStart, state.scan);
                state.scan++; // Skip null terminator
            }
        }

        return {
            opcode: rawOpcode,
            imm,
            imm_obj,
            name: mapping.name,
            returnType: mapping.returnType,
            paramTypes: mapping.paramTypes
        };
    }

    writeOpCode(state: any, value: any) {
        // Write the opcode
        state.buffer.writeUInt16BE(value.opcode, state.scan);
        state.scan += 2;

        // Write immediate value if present
        if (value.imm_obj !== null && value.imm_obj !== undefined) {
            if (typeof value.imm_obj === 'number') {
                state.buffer.writeInt32BE(value.imm_obj, state.scan);
                state.scan += 4;
            } else if (typeof value.imm_obj === 'string') {
                const stringBytes = Buffer.from(value.imm_obj, 'utf8');
                stringBytes.copy(state.buffer, state.scan);
                state.scan += stringBytes.length;
                state.buffer.writeUInt8(0, state.scan++); // Null terminator
            }
        }
    }
}