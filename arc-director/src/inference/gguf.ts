/** Each GGUF value type's size in bytes, by its type id; strings and arrays carry their own length. */
const SIZE = [1, 1, 2, 2, 4, 4, 4, 1, 0, 0, 8, 8, 8];
const STRING = 8;
const ARRAY = 9;
/** 'GGUF', read as a little-endian number. */
const MAGIC = 0x46554747;
/** Bytes read from the file at a time: its tokenizer alone holds a quarter of a million strings. */
const CHUNK = 1 << 20;

/**
 * A GGUF file's metadata, read from its header without loading the model: each number as a number, each string as
 * text, and each array of numbers as its largest (a per-layer count, as some models give one, at its most). Arrays of
 * strings (the tokenizer's) are skipped. For a split model, the first part holds it.
 */
export async function ggufMetadata(file:Blob):Promise<Map<string, string | number>> {
	const r = new BlobReader(file);
	if (await r.number(4) !== MAGIC) {
		throw new Error('not a GGUF file');
	}
	await r.number(4); // version
	await r.number(10); // tensor count
	const count = await r.number(10);
	const meta = new Map<string, string | number>();
	for (let i = 0; i < count; i++) {
		const key = await r.text();
		const type = await r.number(4);
		if (type === STRING) {
			meta.set(key, await r.text());
		}
		else if (type === ARRAY) {
			const of = await r.number(4);
			const n = await r.number(10);
			if (of === STRING) {
				for (let j = 0; j < n; j++) {
					r.skip(await r.number(10));
				}
			}
			else {
				let most = -Infinity;
				for (let j = 0; j < n; j++) {
					most = Math.max(most, await r.number(of));
				}
				if (n > 0) {
					meta.set(key, most);
				}
			}
		}
		else {
			meta.set(key, await r.number(type));
		}
	}
	return meta;
}

/** Reads a `Blob` front to back, a {@link CHUNK} at a time. */
class BlobReader {
	private _view = new DataView(new ArrayBuffer(0));
	private _start = 0;
	private _pos = 0;

	constructor(private readonly _blob:Blob) {}

	public skip(bytes:number):void {
		this._pos += bytes;
	}

	/** A value of GGUF number type `type`, as a number. */
	public async number(type:number):Promise<number> {
		const size = SIZE[type];
		if (!size) {
			throw new Error(`GGUF value type ${type} is not a number`);
		}
		const at = await this.need(size);
		const v = this._view;
		switch (type) {
			case 0: case 7: return v.getUint8(at);
			case 1: return v.getInt8(at);
			case 2: return v.getUint16(at, true);
			case 3: return v.getInt16(at, true);
			case 4: return v.getUint32(at, true);
			case 5: return v.getInt32(at, true);
			case 6: return v.getFloat32(at, true);
			case 10: return Number(v.getBigUint64(at, true));
			case 11: return Number(v.getBigInt64(at, true));
			default: return v.getFloat64(at, true);
		}
	}

	public async text():Promise<string> {
		const length = await this.number(10);
		const at = await this.need(length);
		return new TextDecoder().decode(new Uint8Array(this._view.buffer, at, length));
	}

	/** Makes the next `bytes` readable and moves past them: where they start in the view. */
	private async need(bytes:number):Promise<number> {
		if (this._pos < this._start || this._pos + bytes > this._start + this._view.byteLength) {
			this._start = this._pos;
			this._view = new DataView(await this._blob.slice(this._pos, this._pos + Math.max(bytes, CHUNK)).arrayBuffer());
			if (this._view.byteLength < bytes) {
				throw new Error('the GGUF file ends early');
			}
		}
		const at = this._pos - this._start;
		this._pos += bytes;
		return at;
	}
}
