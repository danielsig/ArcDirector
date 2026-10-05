import { Component } from '../engine/Component';
import type { ItemInstance } from './instance';

export class Item extends Component {
	static override saved = ['count'];
	defID = '';
	count = 1;
	stackable = false;
	maxStack = 1;
}

export class Pickupable extends Component {}

export class Equipable extends Component {
	slots:string[] = [];
	hands:0 | 1 | 2 = 0;
}

export class Container extends Component {
	static override saved = ['size', 'contents'];
	size = 2;
	contents:ItemInstance[] = [];
}

export class Weapon extends Component {
	damage = 1;
	range = 1.6;
}

export class Blade extends Component {}

export class Armor extends Component {
	defense = 0;
	covers:string[] = [];
}

export class Consumable extends Component {
	effect = 'heal';
	amount = 1;
	consumeOnUse = true;
}

export class Key extends Component {
	keyID = '';
}

export class Harvest extends Component {
	harvester = 'Herbalist';
}
