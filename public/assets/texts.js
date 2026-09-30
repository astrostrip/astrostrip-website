// Big Three texts for the calculator result.
// Source: reference/tierkreiszeichen.md (Archetyp, Stärken, Schatten, Klischee-Check).
// Tone: astro.strip (context/branddesign.md) - sharp, psychological, no healing vocabulary.
// Scorpio, Aquarius, Pisces: traditional ruler first, modern second (Sandra, 16.09.2026).

export const ROLES = {
  rising: { label: 'RISING', role: 'FIRST IMPRESSION' },
  sun: { label: 'SUN', role: 'CORE IDENTITY' },
  moon: { label: 'MOON', role: 'EMOTIONAL PATTERN' },
};

export const TEXTS = {
  Aries: {
    sun: ['Built to start.', 'You find out who you are by doing, not by waiting. The oldest texts call Aries fearful-hearted: the courage is real because it overrides the fear, not because there is none.'],
    rising: ['First in, first seen.', 'People meet your speed before they meet you: direct, quick, allergic to games. What they don’t see is how much of that pace keeps stillness away.'],
    moon: ['Feels it, says it, done.', 'Anger comes out fast and rarely turns into a grudge. What really rattles you is being stuck. Movement is how you feel safe.'],
  },
  Taurus: {
    sun: ['Not slow. Selective.', 'You turn energy into something real, useful and lasting. Manilius called Taurus the leader of work, not the lazy one. You just won’t move without a reason.'],
    rising: ['Calm is what people read first.', 'You come across steady and hard to push, and pressure tends to run out of breath before you do. Behind the calm sits a lot you never say out loud.'],
    moon: ['Safety you can touch.', 'You feel secure through what is tangible: routines, people who stay, things that are real. Anger gets swallowed for a long time. And then it doesn’t.'],
  },
  Gemini: {
    sun: ['Not two-faced. Two-sided.', 'You make sense of the world by comparing, naming, connecting. In the myth the twins never betrayed each other: one lived in the light, one in the underworld. You know both.'],
    rising: ['Three topics ahead.', 'People meet your mind first: fast, funny, easy to talk to. The joke often lands exactly where it hurts most.'],
    moon: ['Feelings, translated into words.', 'You process emotion by talking, reading, understanding. You need room to move, and the darker, brooding phases usually stay hidden.'],
  },
  Cancer: {
    sun: ['Soft is the wrong word.', 'You protect what belongs to you and you don’t give up ground. Valens described Cancer as ambitious and public. The shell exists so the inside can stay soft.'],
    rising: ['Shell first. Then the rest.', 'You come across warm but guarded, and you read a room before you step into it. You approach problems sideways, which is exactly why you see angles others miss.'],
    moon: ['Where am I safe, and who is mine?', 'Your emotional life runs on belonging and memory. The past never fully leaves. When you feel exposed, you tend to withdraw rather than fight.'],
  },
  Leo: {
    sun: ['The proudest sign doubts.', 'You want to be seen as who you really are, not as the role. Behind the big gesture there is often a quieter question: is this enough?'],
    rising: ['Presence before a single word.', 'People notice you, and they notice your warmth: direct, loyal, no games. Criticism lands harder than you let anyone see.'],
    moon: ['Needs to be felt, not flattered.', 'You feel safe when your warmth is received and what you give is actually seen. The old texts say Leo hates flattery. You need resonance, not applause.'],
  },
  Virgo: {
    sun: ['Practical, not perfect.', 'You sort, refine and fix the small thing before it becomes the big one. Virgo originally meant a woman who belongs to herself. Not prim. Your own.'],
    rising: ['You notice what’s off. Instantly.', 'People meet your precision first: clear, useful, a little reserved. The critic they sense is usually aimed at yourself first.'],
    moon: ['Calm comes from order.', 'You feel safe when things make sense and work. When they don’t, worry takes over, and you often feel it in your gut before you can name it.'],
  },
  Libra: {
    sun: ['Not balanced. Weighing.', 'You evaluate: what is fair, what fits, what is true between you and everyone else. Saturn is exalted here. Harmony isn’t a mood for you, it’s something you build, sometimes against the current.'],
    rising: ['The smile isn’t agreement.', 'You come across graceful and diplomatic, and people often end up thinking your idea was theirs. Underneath runs one of the most underestimated drives in the zodiac.'],
    moon: ['Peace, at a price.', 'You feel safe when things between people are right. Anger that feels “ugly” gets held back. Until it isn’t.'],
  },
  Scorpio: {
    sun: ['Feels everything. Shows nothing.', 'You want what is real under the surface, and someone you can trust enough to let in. Ruled by Mars and Pluto: less machine gun, more sniper.'],
    rising: ['You read people. They can’t read you.', 'People sense intensity and reserve, and you see through pretence early. Trust is earned slowly. Then it holds.'],
    moon: ['Nothing is just forgotten.', 'Feelings don’t pass through you, they are stored. You feel safe with depth and loyalty, and control is how you protect the soft part.'],
  },
  Sagittarius: {
    sun: ['Not lucky. Tuned in.', 'You look for meaning and see the pattern, and the opportunity, before others do. The oldest image isn’t a party traveller but an armed archer: honest, direct, sometimes brutally so.'],
    rising: ['Honest before polite.', 'People meet your enthusiasm and your bluntness at the same time. Aim at the horizon and you can miss the person standing right next to you.'],
    moon: ['Needs room to breathe.', 'You feel safe when life has meaning and space ahead. Narrowness feels like a threat. Conflict gets said out loud, and then it’s over.'],
  },
  Capricorn: {
    sun: ['Built to last.', 'You build what holds over time, and you can wait for the reward. The original symbol is a sea-goat: the climb up the mountain, and the depth underneath.'],
    rising: ['Composed. Not cold.', 'You come across serious and capable, and people hand you responsibility early. The coolness is control, not emptiness.'],
    moon: ['Care, shown by doing.', 'You show feeling through action and reliability more than words. You feel safe in control, and you often expect more of yourself than anyone else would.'],
  },
  Aquarius: {
    sun: ['Not a rebel. A truth-teller.', 'You want a fair whole where everyone has a place, including you, without being absorbed. Ruled by Saturn and Uranus: the “alien” is modern. The old Aquarius is courteous, measured and hard to manipulate.'],
    rising: ['Friendly, from a distance.', 'People meet your openness and your independent mind. Belonging is easy for you, as long as you don’t have to disappear into it.'],
    moon: ['Understands feelings first.', 'You process emotion by understanding it, which keeps you fair under pressure. Closeness can feel like losing control, so distance becomes your safety.'],
  },
  Pisces: {
    sun: ['Not weak. Porous.', 'You want to dissolve the line between you and the world, through art, empathy, meaning. Ruled by Jupiter and Neptune, and Rudhyar saw storms in these waters, not just drift.'],
    rising: ['People feel understood around you.', 'You come across gentle and hard to pin down, and you pick up moods before anyone speaks. To avoid a clash, the truth sometimes gets soft-focused.'],
    moon: ['Feels what the room feels.', 'Your emotional life has few walls: other people’s moods easily become your own. You need time to drift and dream, and withdrawal is how you protect yourself.'],
  },
};
