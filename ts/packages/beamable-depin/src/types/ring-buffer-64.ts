import { Codec, Endian, getArrayCodec, getStructCodec, getU64Codec, getU8Codec } from "gill";

export interface RingBuffer64Data {
    buffer: bigint[];
    current_index: number;
}

export class RingBuffer64 implements RingBuffer64Data {
    buffer: bigint[];
    current_index: number;
    capacity: number;

    public static getDataCodec(size: number): Codec<RingBuffer64Data> {
        return getStructCodec([
            ["buffer", getArrayCodec(getU64Codec({ endian: Endian.Little }), { size })],
            ["current_index", getU8Codec()]
        ]);
    }

    public static getLen(size: number): number {
        return (8 * size) + 1; // 8 bytes for each u64 + 1 byte for current_index
    }

    constructor(fields: RingBuffer64Data, capacity: number) {
        this.buffer = fields.buffer;
        this.current_index = fields.current_index;
        this.capacity = capacity;
    }

    public getAllValues(): bigint[] {
        const result: bigint[] = [];
        
        for (let i = 0; i < this.capacity; i++) {
            const index = (this.current_index + i) % this.capacity;
            result.push(this.buffer[index]);
        }
        
        return result;
    }
}
