export function squadTag(conductorID:string, short:string):string {
	return `${conductorID}:${short.trim()}`;
}

export function shortTag(conductorID:string, stored:string):string {
	const prefix = `${conductorID}:`;
	return stored.startsWith(prefix) ? stored.slice(prefix.length) : stored;
}

export function isSquadTag(conductorID:string, stored:string):boolean {
	return stored.startsWith(`${conductorID}:`);
}
