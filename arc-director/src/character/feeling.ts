/**
 * What a character shows on its face and body, `express(feeling)`, until it fades: onlookers see it, and its voice
 * carries it. The stock feelings are {@link FEELINGS}; a game that shows feelings its own way names exactly the ones it
 * can show with `withFeelings({ feelings })`, which replace them, and `express` lists those.
 */
export const Feeling = { Happy: 'happy', Sad: 'sad', Angry: 'angry', Afraid: 'afraid', Surprised: 'surprised', Disgusted: 'disgusted', Stressed: 'stressed', Loving: 'loving' } as const;
export type Feeling = (typeof Feeling)[keyof typeof Feeling] | (string & {});

/**
 * How strongly each feeling is felt, 0 to 1, by name: several at once (a surprise gift, happy and surprised; a roller
 * coaster, happy and stressed; paranoia, afraid and stressed).
 */
export type FeelingLevels = Readonly<Record<string, number>>;

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

/** A character's mood, as recall reads it: how strongly it feels each feeling, and every feeling's `memories` to tell its own by. */
export interface Mood {
	levels:FeelingLevels;
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
	// Told apart from the rest as well as they are from each other, afraid and surprised too, on three embedding models.
	// Arousal under pressure, thrilling as well as grim, and the keyed-up watchfulness of a sentry. A gun at the chest is
	// left to afraid: with it, stress swallowed fear's memories. Two watchful anchors in four of stress catch watches 23
	// times in 30 (stress alone, 11) and leave the other seven as they were, on three embedding models.
	stressed: {
		looking: 'stressed',
		adverb: 'tensely',
		memories: [
			'My heart hammered on the roller coaster and I screamed the whole way down.',
			'I stood before the whole hall to give my speech, my hands shaking.',
			'Steel rang as we fought, and there was no time to think.',
			'I had far too much to do and no time to do it.',
			'I stood the night watch with every sound sharp in my ears.',
			'I held my breath and listened for the footsteps again.',
		],
	},
	// Warmth and care toward someone, a stranger and an enemy too (compassion, sympathy), apart from happy: told apart from
	// the rest on three embedding models, it tells compassion from emptiness and resignation, and affection from joy. With
	// the strangers in, care for strangers read as loving 3 to 7 times in 8 (family and friends alone, 1 to 3).
	loving: {
		looking: 'fond',
		adverb: 'warmly',
		memories: [
			'I held her hand and never wanted to let go.',
			'I would give my life for my children.',
			'She was my dearest friend, and I trusted her with everything.',
			'I gave my only coat to a shivering stranger and walked home in the snow, glad of it.',
			'I nursed a wounded enemy soldier back to health, because no one should die alone.',
			'I sat with the grieving widow all night and felt her sorrow as if it were my own.',
		],
	},
};
