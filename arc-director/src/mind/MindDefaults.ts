import type { ArcResult } from '../arc/arc-types.js';
import type { MindSettings } from './mind.js';
import type { ArcFormat } from './mind-types.js';
import type { ThinkInstructions } from './prompt.js';

/**
 * The director's layer of every mind's settings (`withMind`): what a mind reads where its own settings leave one
 * unset. A change reaches every mind on its next think, attached already or not. One `with*` per setting.
 */
export class MindDefaults {
	public readonly settings:MindSettings = {};

	/** No think on the queue's heartbeat; only watches, events and arc ends wake a mind. */
	public withSkipHeartbeat(on = true):this {
		this.settings.skipHeartbeat = on;
		return this;
	}

	/** Major events do not wake a mind. */
	public withSkipMajor(on = true):this {
		this.settings.skipMajor = on;
		return this;
	}

	/** No think when a mind joins: it waits for something to happen. */
	public withSkipStart(on = true):this {
		this.settings.skipStart = on;
		return this;
	}

	/** No goal or identity revision, on the timer or after a major event. */
	public withSkipStrategic(on = true):this {
		this.settings.skipStrategic = on;
		return this;
	}

	/** Tie-break after watch `rankScore`. Higher goes first. Default 0. */
	public withRank(rank:number):this {
		this.settings.rank = rank;
		return this;
	}

	/** Fewest game seconds between tactical thinks. Default 0, since the think queue paces thinks. */
	public withHeartbeat(seconds:number):this {
		this.settings.heartbeat = seconds;
		return this;
	}

	/** Game seconds between goal revisions; 0 never revises. Default 180. */
	public withStrategicInterval(seconds:number):this {
		this.settings.strategicInterval = seconds;
		return this;
	}

	/** The model minds think with, by its name (`addModel`), in place of the director's default. */
	public withModel(name:string):this {
		this.settings.model = name;
		return this;
	}

	/** How much of Current Conversation to show, in letters. Default: one quarter of the model's context window; 0 shows none. */
	public withConversationCap(letters:number):this {
		this.settings.conversationCap = letters;
		return this;
	}

	/** How many of its own laws' results since its last think a prompt pins, newest kept. Default 5. */
	public withLawResults(count:number):this {
		this.settings.lawResults = count;
		return this;
	}

	/** How minds write an Arc: `text`, `json`, or `schema` (JSON the server must follow; default). */
	public withArcFormat(format:ArcFormat):this {
		this.settings.arcFormat = format;
		return this;
	}

	/** The standing think line per reasoning state. Defaults: `on` `DEFAULT_THINK_INSTRUCTIONS`, `off` nothing. */
	public withThinkInstructions(lines:ThinkInstructions):this {
		this.settings.thinkInstructions = lines;
		return this;
	}

	/** The standing verb-chain line. Default `DEFAULT_VERB_INSTRUCTIONS`, plus looping programs for a collective; this replaces both. */
	public withVerbInstructions(text:string):this {
		this.settings.verbInstructions = text;
		return this;
	}

	/** The Arc that closes the prompt as its Example, in place of the stock one. Models copy it, so make it valid. */
	public withArcExample(arc:string):this {
		this.settings.arcExample = arc;
		return this;
	}

	/** One sentence in every mind's system prefix, after who it is. */
	public withSystemNote(text:string):this {
		this.settings.systemNote = text;
		return this;
	}

	/**
	 * The item id the world pays with (`gold`). Minds are told how `give` and `offer` move it, the purse is counted in it,
	 * and handing it over is remembered as paying. Without one, nothing is said about money.
	 */
	public withCurrency(name:string):this {
		this.settings.currency = name;
		return this;
	}

	/** Tool rounds a think may spend before it must write the Arc. Default `DEFAULT_TOOL_ROUNDS`; 0 offers no tools. */
	public withToolRounds(rounds:number):this {
		this.settings.toolRounds = rounds;
		return this;
	}

	/**
	 * Repair turns after a bad Arc. Default 0: a bad reply fails the think. Each retry samples as the model does, so a
	 * model that wrote one bad reply does not write it again word for word.
	 */
	public withRepairRetries(retries:number):this {
		this.settings.repairRetries = retries;
		return this;
	}

	/**
	 * The steps of a reply that need no body (`issue`, `law`, `when`, `say`, ...) are judged each on its own: the good ones
	 * stand, the model's turn shows only those, and it is told in words what became of the rest, to replace just them. A
	 * reply that does not read at all still goes back whole.
	 */
	public withRepairPerStep(on = true):this {
		this.settings.repairPerStep = on;
		return this;
	}

	/**
	 * A watch that reads a field no one in sight has (`u.foo`) goes back for repair too: it would only ever be false. Leave
	 * it off if your entities gain fields later.
	 */
	public withRepairUnknownFields(on = true):this {
		this.settings.repairUnknownFields = on;
		return this;
	}

	/** Whether a finished arc stalled, which stretches the heartbeat. Default: it failed or was interrupted. */
	public withStalled(fn:(result:ArcResult)=>boolean):this {
		this.settings.stalled = fn;
		return this;
	}

	/** How close a memory must come to what is before a mind to come to mind unasked (0–1). Default 0.55. */
	public withIntrusionThreshold(threshold:number):this {
		this.settings.intrusionThreshold = threshold;
		return this;
	}

	/** Game seconds between two memories that come to mind unasked. Default 45. */
	public withIntrusionCooldown(seconds:number):this {
		this.settings.intrusionCooldown = seconds;
		return this;
	}

	/** Memories brought into each prompt, and the most `recall` returns. Default 5. */
	public withRecallK(count:number):this {
		this.settings.recallK = count;
		return this;
	}

	/** No `observe` tool. */
	public withHideObserve(on = true):this {
		this.settings.hideObserve = on;
		return this;
	}
}
