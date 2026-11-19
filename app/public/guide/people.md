# Recognizing people

The agent can know **who is speaking**, by their voice, and some patterns can be kept for some people. In a car, the parents change the route and the children can't, but they can ask for a cartoon on the back screen.

## Record someone

In [Settings](view:settings), under **People**:

1. Type the person's **name**, as the agent should call them (`Léa`, `Papa`).
2. Choose the **text to read**, in French or in English, and click **Record**.
3. The person reads the text aloud, in their usual voice, then clicks **Stop**. About 20 seconds: at least 8 seconds of voice are needed.
4. Click **Who is speaking?** and let them say a sentence: their name should come up, with a score.

Record each person with the microphone of the conversation, in the room where it takes place. Recording the same name again replaces their voice. **Delete** forgets it.

**Ask each person first.** What is kept is a voiceprint, 512 numbers that describe a voice, never the recording. It is still personal data: it stays on this computer, in Settings, never in an agent, so an agent you share carries nobody's voice.

## In a conversation

At the end of each turn, the voice is compared with the people recorded:

- **Talk** shows their name instead of "You", and "Why it answered" shows it with its score.
- **`{speaker}`** is the name of the person speaking, in a line to say, an instruction or a message: `Voilà, {speaker} !`
- The **language model** is told who it is talking with. The small local model rarely says a name by itself: to hear it, write `{speaker}` in a line to say.
- The **clients** get the event `speaker` (the name, or `''` for someone not recognized), and `user.text` has a `speaker` field: a p5.js sketch can show who is talking.

Someone not recorded, or a voice too far from everyone's, is **someone not recognized**: no name. So is an answer too short to tell. The agent never guesses from the person who spoke before: a child's "oui" is not a parent's.

## Patterns for some people

A pattern triggered by speech (**says**, **mentions**, **nothing else fits**) has a **Who** field, next to its stage:

- **Anyone**, the default.
- **Only…**: tick the people who may trigger it.

When someone else asks for it, or someone not recognized, and no other pattern fits, the agent doesn't do it, and says so: "Pardon Léo, c'est à Papa ou Maman de me le demander." (or "Pardon, je ne reconnais pas ta voix : …"), in the language of the conversation. "Why it answered" shows **Not for Léo**.

**To answer them your way**, duplicate the pattern, keep the copy for the others (Who → Only… → Léo, Zoé), and give it your own line: "Demande à Papa, {speaker} !". A pattern they may trigger always comes first.

The car, as patterns:

| pattern | when | who | then |
|---|---|---|---|
| Change the route | says "on va plutôt à Lyon", "change l'itinéraire" | only Papa, Maman | Send OSC `/car/route` with the value `{said}`, then Say "D'accord {speaker}, je change l'itinéraire." |
| A cartoon | says "mets un dessin animé", "je veux une vidéo" | anyone | Send a signal `back-screen` with the value `cartoon`, then Say "Voilà un dessin animé, {speaker} !" |

A **Say** line is safer than an **Answer** for a confirmation: the small model sometimes misreads what it should confirm.

To try a pattern without the person, type in [Talk](view:talk) and pick **as Léo** next to the field: it is decided as if Léo had said it.

## How reliable it is

Measured on recordings of 40 people (LibriSpeech), with a family of 4 recorded:

- **a sentence:** the right name 96 to 99 % of the time; someone else's name almost never (under 0.2 %); a stranger stays unrecognized 97 % of the time;
- **a short answer (half a second):** the right name 9 times out of 10; the rest, nobody.

The model rarely mixes two people up: when it isn't sure, it gives no name. A noisy room, a far microphone, a cold, a whisper or a shout lower the score: record again in the real conditions if someone is often not recognized. Two voices at once count as one turn.

It is not a lock: a recording of someone's voice can pass for them. Don't keep anything serious behind it.
