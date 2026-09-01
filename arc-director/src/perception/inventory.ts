export type Inventory = {
	worn?:Record<string, string>;
	purse?:number;
	pockets?:string[];
	pack?:{ name:string; items:string[] };
};
