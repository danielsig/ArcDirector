/** Shared tile colors for the player minimap and NPC `see_map` snapshots. */

export function tileFill(def:string, blocked:boolean, height:number):string {
	if (blocked) {
		return '#3a2a22';
	}
	if (def === 'stairs') {
		return '#8a7a5c';
	}
	if (height > 0) {
		return '#6e5a44';
	}
	if (def === 'grass') {
		return '#3d6e34';
	}
	if (def === 'water') {
		return '#3a6a8a';
	}
	return '#c4a574';
}
