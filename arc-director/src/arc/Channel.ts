/**
 * The channel a verb holds while it runs (`VerbDef.channel`): its body (the default: moving, fighting, using things), its
 * voice (`say`), or none (`remember`, `law`, `wait`). A game adds its own (`'hands'`, to drink while walking).
 */
export const Channel = { Body: 'body', Voice: 'voice', None: '' } as const;
export type Channel = (typeof Channel)[keyof typeof Channel] | (string & {});
