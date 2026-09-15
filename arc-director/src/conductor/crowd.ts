import { CrowdUnit, type CrowdUnitJSON, type CrowdUnitSpec } from './unit.js';

export class Crowd {
	private readonly rows = new Map<string, CrowdUnit>();

	get size():number {
		return this.rows.size;
	}

	add(unit:CrowdUnit):CrowdUnit {
		this.rows.set(unit.id, unit);
		return unit;
	}

	remove(id:string):CrowdUnit | undefined {
		const unit = this.rows.get(id);
		if (!unit) {
			return undefined;
		}
		unit.interrupt();
		this.rows.delete(id);
		return unit;
	}

	get(id:string):CrowdUnit | undefined {
		return this.rows.get(id);
	}

	has(id:string):boolean {
		return this.rows.has(id);
	}

	list():CrowdUnit[] {
		return [...this.rows.values()];
	}

	toJSON():CrowdUnitJSON[] {
		return this.list().map((u) => u.toJSON());
	}

	replace(units:CrowdUnitSpec[], tagOf:(short:string)=>string):void {
		this.rows.clear();
		for (const spec of units) {
			const tags = (spec.tags ?? []).map((t) => t.includes(':') ? t : tagOf(t));
			this.add(new CrowdUnit(spec.id, tags));
		}
	}
}
