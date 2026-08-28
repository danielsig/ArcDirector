export const MAX_DT = 0.05;

export const Time = {
	time: 0,
	deltaTime: 0,
	fixedDeltaTime: 0.02,
	fixedTime: 0,
};

export function resetTime():void {
	Time.time = 0;
	Time.deltaTime = 0;
	Time.fixedTime = 0;
	Time.fixedDeltaTime = 0.02;
}
