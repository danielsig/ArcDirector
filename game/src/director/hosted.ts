import { systemOneName, type SystemOneKind } from '../prefs';

/**
 * Which hosted services the dev server holds a key for, in the repo-root `.env`: `TYPE_SAFE_KEY` for TypeSafe's Jev,
 * `XAI_API_KEY` for xAI's models. Set from `vite.config.ts` as flags only; the keys never reach the page. A service
 * without its key is not offered anywhere.
 */
export const HOSTED:{ readonly jev:boolean; readonly xai:boolean } = __HOSTED__;

/** The director's default System One for the menu's choice: Jev only with its key, else the local one. */
export function defaultSystemOne(kind:SystemOneKind):string | null {
	return systemOneName(kind === 'jev' && !HOSTED.jev ? 'local' : kind);
}
