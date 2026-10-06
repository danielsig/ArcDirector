import { Component as KindlingComponent } from '@arc-director/kindling';
import type { GameObject } from './GameObject';

export abstract class Component extends KindlingComponent {
	declare gameObject:GameObject;
}
