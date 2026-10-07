/** A tag a collective's `tag` verb puts on its characters: `DawnParty:Point`. It goes when they leave. */
export function squadTag(collectiveID:string, short:string):string {
	return `${collectiveID}:${short.trim()}`;
}

export function shortTag(collectiveID:string, stored:string):string {
	const prefix = `${collectiveID}:`;
	return stored.startsWith(prefix) ? stored.slice(prefix.length) : stored;
}

export function isSquadTag(collectiveID:string, stored:string):boolean {
	return stored.startsWith(`${collectiveID}:`);
}
