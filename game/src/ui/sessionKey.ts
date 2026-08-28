import type { InjectionKey, ShallowRef } from 'vue';
import type { Session } from '../engine/Session';

export const sessionKey:InjectionKey<ShallowRef<Session | null>> = Symbol('session');
