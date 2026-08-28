export function envGet(key:string):string | undefined {
	const g = globalThis as {
		process?:{ env?:Record<string, string | undefined> };
	};
	const value = g.process?.env?.[key];
	return value === undefined || value === '' ? undefined : value;
}
