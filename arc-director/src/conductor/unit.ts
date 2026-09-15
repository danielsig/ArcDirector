import type { ActionPlan } from '../action/types.js';
import type { PlanSession } from '../agent/run.js';

export type CrowdUnitJSON = {
	id:string;
	tags:string[];
};

export type CrowdUnitSpec = {
	id:string;
	tags?:string[];
};

export class CrowdUnit {
	readonly id:string;
	tags:string[];
	plan:ActionPlan | null = null;
	verb = '';
	lawName:string | null = null;
	generation = 0;
	stepToken = 0;
	inflight:Promise<void> | null = null;
	session:PlanSession | null = null;
	coolUntil = new Map<string, number>();

	constructor(id:string, tags:string[] = []) {
		this.id = id;
		this.tags = [...tags];
	}

	get busy():boolean {
		return this.plan !== null || this.inflight !== null;
	}

	interrupt():void {
		this.generation += 1;
		this.stepToken += 1;
		this.plan = null;
		this.verb = '';
		this.lawName = null;
		this.inflight = null;
		this.session = null;
	}

	toJSON():CrowdUnitJSON {
		return { id: this.id, tags: [...this.tags] };
	}

	static fromJSON(json:CrowdUnitJSON):CrowdUnit {
		return new CrowdUnit(json.id, json.tags);
	}
}
