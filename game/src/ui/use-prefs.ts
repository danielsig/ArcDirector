import { computed, reactive, readonly, type WritableComputedRef } from 'vue';
import { prefs, prefsDetached, setPrefs, watchPrefs, type Prefs } from '../prefs';

/** The UI's one copy of the prefs, kept in step by the store's own watcher. `detached`: this page no longer saves them. */
const live = reactive({ ...prefs(), detached: prefsDetached() });
watchPrefs((next) => {
	Object.assign(live, next, { detached: prefsDetached() });
});
const shared = readonly(live);

/** The live prefs for templates and computeds. Read-only: writes go through `setPrefs`, which coerces and saves them. */
export function usePrefs():Readonly<Prefs & { detached:boolean }> {
	return shared;
}

/** One pref as a `v-model`: reads the live value, writes through `setPrefs`. */
export function usePref<K extends keyof Prefs>(key:K):WritableComputedRef<Prefs[K]> {
	return computed({
		get: () => live[key] as Prefs[K],
		set: (value) => {
			setPrefs({ [key]: value });
		},
	});
}
