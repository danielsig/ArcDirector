import { looseItem } from '../items/pickup';
import { bridge } from './bridge/bridge';
import { campfire } from './campfire/campfire';
import { chest } from './chests/chest';
import { cobweb } from './cobweb/cobweb';
import { door } from './door/door';
import { house } from './houses/house';
import { inscription } from './inscription/inscription';
import { waterfall } from './land/waterfall';
import { moonlight } from './moonlight/moonlight';
import { pillar } from './pillars/pillar';
import { boulder } from './rocks/boulder';
import { stall } from './stall/stall';
import type { Thing } from './thing';
import { fire } from './torches/fire';
import { torch } from './torches/torch';
import { tree } from './trees/trees';

/** Every kind of thing on the maps, in the order they spawn on a chunk: houses last, as they find their door by name. */
export const THINGS:readonly Thing[] = [door, chest, bridge, torch, fire, campfire, cobweb, inscription, stall, tree, pillar, boulder, waterfall, moonlight, looseItem, house];
