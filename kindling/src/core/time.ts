export const MAX_DT = 0.05;

export const Time = {
	time: 0,
	deltaTime: 0,
	fixedDeltaTime: 0.02,
	fixedTime: 0,
};

/** Restart the clock at `time` (a loaded save's), with no fixed steps owed. */
export function resetTime(time = 0):void {
	Time.time = time;
	Time.deltaTime = 0;
	Time.fixedTime = time;
	Time.fixedDeltaTime = 0.02;
}
