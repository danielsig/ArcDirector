import {
	clearArcControl,
	connectControl,
	installArcControl,
	type ControlDispatch,
	type ControlLink,
} from '@arc-director/control';
import { dispatchControl } from './dispatch';
import type { Session } from '../engine/Session';
import { readURLSession, writeURLSession } from '../engine/urlView';

export function bindArcControl(session:Session):()=>void {
	const dispatch:ControlDispatch = (command) => dispatchControl(session, command);
	installArcControl(dispatch);
	const id = readURLSession();
	let link:ControlLink | null = null;
	if (id) {
		link = connectControl({ session: id, dispatch, onSession: writeURLSession });
	}
	return () => {
		link?.close();
		clearArcControl(dispatch);
	};
}
