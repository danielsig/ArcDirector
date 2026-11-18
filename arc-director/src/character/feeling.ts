/**
 * What a character shows on its face and body, `express(feeling)`, until it fades: onlookers see it, and its voice
 * carries it. The stock feelings are {@link FEELINGS}; a game that shows feelings its own way names exactly the ones it
 * can show with `withFeelings({ feelings })`, which replace them, and `express` lists those.
 */
export const Feeling = { Happy: 'happy', Sad: 'sad', Angry: 'angry', Afraid: 'afraid', Surprised: 'surprised', Disgusted: 'disgusted' } as const;
export type Feeling = (typeof Feeling)[keyof typeof Feeling] | (string & {});

/** What a feeling is in words: how one showing it looks to onlookers (`looking angry`), and how its voice says a line (`says angrily`). */
export type FeelingDef = { looking:string; adverb:string };

export const FEELINGS:Readonly<Record<(typeof Feeling)[keyof typeof Feeling], FeelingDef>> = {
	happy: { looking: 'happy', adverb: 'happily' },
	sad: { looking: 'sad', adverb: 'sadly' },
	angry: { looking: 'angry', adverb: 'angrily' },
	afraid: { looking: 'afraid', adverb: 'fearfully' },
	surprised: { looking: 'surprised', adverb: 'in surprise' },
	disgusted: { looking: 'disgusted', adverb: 'in disgust' },
};
