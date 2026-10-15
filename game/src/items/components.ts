import { Component } from '@arc-director/kindling';
import type { ItemInstance } from './instance';

export class Item extends Component {
	public static override saved = ['count'];
	public defID = '';
	public count = 1;
	public stackable = false;
	public maxStack = 1;
}

export class Pickupable extends Component {}

export class Equipable extends Component {
	public slots:string[] = [];
	public hands:0 | 1 | 2 = 0;
}

export class Container extends Component {
	public static override saved = ['size', 'contents'];
	public size = 2;
	public contents:ItemInstance[] = [];
}

export class Weapon extends Component {
	public damage = 1;
	public range = 1.6;
}

export class Blade extends Component {}

export class Bow extends Component {}

export class Armor extends Component {
	public defense = 0;
	public covers:string[] = [];
}

export class Consumable extends Component {
	public effect = 'heal';
	public amount = 1;
	public consumeOnUse = true;
}

export class Key extends Component {
	public keyID = '';
}

export class Harvest extends Component {
	public harvester = 'Herbalist';
}
