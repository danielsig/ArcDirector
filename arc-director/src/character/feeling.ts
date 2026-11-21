/**
 * What a character shows on its face and body, `express(feeling)`, until it fades: onlookers see it, and its voice
 * carries it. The stock feelings are {@link FEELINGS}; a game that shows feelings its own way names exactly the ones it
 * can show with `withFeelings({ feelings })`, which replace them, and `express` lists those.
 */
export const Feeling = { Happy: 'happy', Sad: 'sad', Angry: 'angry', Afraid: 'afraid', Surprised: 'surprised', Disgusted: 'disgusted' } as const;
export type Feeling = (typeof Feeling)[keyof typeof Feeling] | (string & {});

/**
 * What a feeling is in words: how one showing it looks to onlookers (`looking angry`), and how its voice says a line
 * (`says angrily`). `memories`: a few memories steeped in it, in the first person (`I cried for weeks after she died.`):
 * while a character shows it, memories like these come to it unbidden more readily (mood-congruent recall), told apart
 * from the other feelings'. Six each serve the stock feelings; a feeling with none brings nothing up.
 */
export interface FeelingDef {
	looking:string;
	adverb:string;
	memories?:readonly string[];
}

/** A character's mood, as recall reads it: the feeling it shows, and every feeling's `memories` to tell its own by. */
export interface Mood {
	feeling:Feeling;
	memories:Readonly<Record<string, readonly string[]>>;
}

export const FEELINGS:Readonly<Record<(typeof Feeling)[keyof typeof Feeling], FeelingDef>> = {
	happy: {
		looking: 'happy',
		adverb: 'happily',
		memories: [
			'That was the happiest day of my life.',
			'We laughed until our sides hurt.',
			'I felt so proud and full of joy.',
			'Everyone cheered and hugged me.',
			'I was in love and the whole world was bright.',
			'We sang and danced all night.',
		],
	},
	sad: {
		looking: 'sad',
		adverb: 'sadly',
		memories: [
			'I cried for weeks after she died.',
			'Everyone I loved is gone now.',
			'I sat alone by the grave until dark.',
			'My heart broke when he never came home.',
			'I miss them every single day.',
			'Nobody came to say goodbye when I left.',
		],
	},
	angry: {
		looking: 'angry',
		adverb: 'angrily',
		memories: [
			'He cheated me and I swore I would make him pay.',
			'They lied to my face and laughed about it.',
			'I wanted to smash his face in.',
			'I will never forgive what they did to me.',
			'I was furious; my hands shook with rage.',
			'They treated me like dirt.',
		],
	},
	afraid: {
		looking: 'afraid',
		adverb: 'fearfully',
		memories: [
			'I hid shaking in the dark while they searched for me.',
			'I was sure I was going to die that night.',
			'My heart pounded and I could not breathe for terror.',
			'Something was following me and I ran for my life.',
			'I still wake up screaming from it.',
			'I froze, too scared to move.',
		],
	},
	surprised: {
		looking: 'surprised',
		adverb: 'in surprise',
		memories: [
			'I could not believe my eyes when I saw it.',
			'It came out of nowhere and I gasped.',
			'To my astonishment, the door was already open.',
			'I never expected that; it took my breath away.',
			'Out of the blue, there he was.',
			'I stared, stunned, at what I had found.',
		],
	},
	disgusted: {
		looking: 'disgusted',
		adverb: 'in disgust',
		memories: [
			'The smell of rot made me retch.',
			'The meat was crawling with maggots.',
			'I felt sick at what he had done.',
			'The filth on the floor turned my stomach.',
			'I spat it out; it was foul.',
			'Just thinking of it makes my skin crawl.',
		],
	},
};
