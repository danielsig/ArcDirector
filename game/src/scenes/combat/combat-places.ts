import type { RoomDef } from '../../world/spawn';

/**
 * A named area of the combat map, corner cell to corner cell. Whoever stands in it has it on its side's mind
 * (`Brune: at WestInnerWall`), its commander is told `You are in WestInnerWall.`, and it is somewhere to go_to.
 */
function place(name:string, from:[number, number], to:[number, number]):RoomDef {
	return { name, from, to, memory: `at ${name}` };
}

/**
 * The temple's named places: one rectangle each, together covering the whole map once, mirrored east to west and north
 * to south. Outer is just outside the temple's outer wall, Inner just inside it; Near and Far run along each road.
 */
export const COMBAT_PLACES:RoomDef[] = [
	place('WestRoadFar', [1, 12], [9, 19]),
	place('WestRoadNear', [10, 12], [16, 19]),
	place('NorthWestWoods', [1, 1], [16, 11]),
	place('WestOuterWall', [17, 1], [19, 30]),
	place('NorthOuterWall', [20, 1], [43, 2]),
	place('NorthWestCorner', [20, 3], [26, 7]),
	place('NorthWestBreach', [20, 8], [22, 12]),
	place('WestInnerWall', [20, 13], [22, 18]),
	place('WestColonnade', [23, 8], [26, 23]),
	place('NorthCourt', [27, 3], [36, 7]),
	place('NorthSanctum', [27, 8], [36, 12]),
	place('WestSanctum', [27, 13], [28, 18]),
	place('Dais', [29, 13], [34, 18]),
	place('SouthWestWoods', [1, 20], [16, 30]),
	place('SouthOuterWall', [20, 29], [43, 30]),
	place('SouthWestCorner', [20, 24], [26, 28]),
	place('SouthWestBreach', [20, 19], [22, 23]),
	place('SouthCourt', [27, 24], [36, 28]),
	place('SouthSanctum', [27, 19], [36, 23]),
	place('EastRoadFar', [54, 12], [62, 19]),
	place('EastRoadNear', [47, 12], [53, 19]),
	place('NorthEastWoods', [47, 1], [62, 11]),
	place('EastOuterWall', [44, 1], [46, 30]),
	place('NorthEastCorner', [37, 3], [43, 7]),
	place('NorthEastBreach', [41, 8], [43, 12]),
	place('EastInnerWall', [41, 13], [43, 18]),
	place('EastColonnade', [37, 8], [40, 23]),
	place('EastSanctum', [35, 13], [36, 18]),
	place('SouthEastWoods', [47, 20], [62, 30]),
	place('SouthEastCorner', [37, 24], [43, 28]),
	place('SouthEastBreach', [41, 19], [43, 23]),
];

/**
 * How the names go, for the minds' scene facts. It never names a side alone: a list of bare compass words had small
 * models write go_to(West).
 */
export const COMBAT_PLACES_ABOUT = [
	'Each place\'s whole name says where it lies: first its side of the temple, then what it is.',
	'OuterWall is just outside the temple\'s outer wall, InnerWall just inside it.',
	'RoadNear is the road by the wall, RoadFar the road out in the wood, and Woods the wood beside the road.',
	'A Breach is a gap in a side wall where the road comes in, a Colonnade the row of pillars inside a side wall, a Court the open ground inside the north or south wall, and a Corner the inside of the outer wall\'s corner.',
	'The Sanctum places ring the raised Dais in the middle. go_to takes only these whole names, never a side alone.',
].join(' ');
