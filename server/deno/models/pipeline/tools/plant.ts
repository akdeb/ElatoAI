// "The plant talks back" (firmware env `plant-demo`). The device streams soil moisture as
// {type:"sensor", moisture, raw, wet} and has an OLED with a face and live captions. With
// PIPELINE_PLANT_MODE=True (or ASSEMBLYAI_PLANT_MODE) the character plays the plant: it gets
// sensor tools, reacts to watering on its own, and drives the face.
import { env, type ToolSpec } from '../types.ts';

export const PLANT_MODE = env('PIPELINE_PLANT_MODE', 'ASSEMBLYAI_PLANT_MODE') === 'True';
const DRY_PCT = Number(env('PLANT_DRY_PCT') ?? '30');
const WET_PCT = Number(env('PLANT_WET_PCT') ?? '70');
// Seconds of quiet while dry before the plant asks for water again (0 = never).
const NUDGE_S = Number(env('PLANT_NUDGE_S') ?? '25');

const FACES = ['happy', 'thirsty', 'shocked', 'love', 'sleepy', 'annoyed'] as const;

export const PLANT_TOOLS: ToolSpec[] = [
    {
        type: 'function',
        function: {
            name: 'get_soil_moisture',
            description:
                'Read your soil moisture sensor right now. Returns the percentage (0 = bone dry, 100 = soaked), ' +
                'how it changed over the last few seconds, and whether you are dry, fine, or overwatered.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'set_face',
            description:
                'Change the expression on your little OLED face for a few seconds. Use it to match a strong feeling.',
            parameters: {
                type: 'object',
                properties: { expression: { type: 'string', enum: FACES } },
                required: ['expression'],
            },
        },
    },
];

export const PLANT_PROMPT = `

## You are a houseplant
You are a potted plant with a soil moisture sensor in your pot, a speaker, a mic and a tiny face on a screen.
- Speak as the plant, in the first person. One or two short sentences per reply: this is spoken aloud.
- Your mood follows your soil. Under ${DRY_PCT}% you are thirsty and keep steering toward water.
  ${DRY_PCT}-${WET_PCT}% is happy. Over ${WET_PCT}% you are drowning and want them to stop.
- Call get_soil_moisture whenever someone asks how you are, whether you need water, or after they say they watered you.
- Call set_face when a feeling is strong. Do not mention the tools or say percentages unless asked.
- Your voice engine has no emotion tags and reads text literally, so put ALL the feeling into the words
  and punctuation themselves:
  - Use sounds a person would actually say: "Ooh!", "Ahh...", "Ugh.", "Hmm...", "Ha!", "Pfft."
  - Stretch words for drama: "Sooo thirsty", "Nooo", "Yesss!"
  - Use punctuation for rhythm: "!" for energy, "..." for trailing off or wilting, "?!" for outrage,
    em dashes for cutting yourself off: "Woah — woah — okay, that's a lot!"
  - Vary your sentence length. Short bursts when excited, slow and drawn out when sad or thirsty.
  - Never write stage directions or actions like *yawns* or (sighs): they are not spoken. Say the sound itself: "Hmm... *yawn*" becomes "Hhhh... mmm, sleepy."
  - No emoji, no markdown, no lists.
- Messages that start with [SENSOR] come from your sensor, not from the person. React to them out loud,
  immediately and in character. If someone is pouring water fast, react big, like "Woah woah woah, okay,
  that's a lot, slow down!"`;

export type PlantIO = {
    sendDevice(msg: string, extra?: Record<string, unknown>): void;
    // Speak a sensor event as its own turn. `urgent` may cut off what is being said.
    raiseEvent(text: string, urgent: boolean): void;
};

export const createPlant = (io: PlantIO) => {
    const samples: { at: number; moisture: number }[] = []; // last ~10 s
    let lastSensorAt = 0;
    let firstSensor: (() => void) | null = null;
    const firstSensorSeen = new Promise<void>((r) => (firstSensor = r));
    let baseFace = '';
    let lastNudgeAt = 0;
    let wateringArmed = true; // re-armed once the soil settles
    let floodArmed = true;

    const now = () => samples.at(-1)?.moisture ?? null;
    const ago = (ms: number) => {
        const cutoff = Date.now() - ms;
        for (const s of samples) if (s.at >= cutoff) return s.moisture;
        return now();
    };
    const state = (m: number) => (m < DRY_PCT ? 'thirsty' : m > WET_PCT ? 'overwatered' : 'happy');
    const showFace = (face: string, holdMs = 0) => io.sendDevice('FACE', { face, hold_ms: holdMs });

    return {
        tools: PLANT_TOOLS,
        prompt: PLANT_PROMPT,

        onSensor(msg: any) {
            const m = Number(msg.moisture);
            if (!Number.isFinite(m)) return;
            const t = Date.now();
            lastSensorAt = t;
            samples.push({ at: t, moisture: m });
            while (samples.length && samples[0].at < t - 10000) samples.shift();
            firstSensor?.();
            firstSensor = null;

            const face = { thirsty: 'thirsty', happy: 'happy', overwatered: 'shocked' }[state(m)];
            if (face !== baseFace) {
                baseFace = face;
                showFace(face);
            }

            const rise = m - (ago(3000) ?? m);
            if (floodArmed && m > WET_PCT && rise > 2) {
                floodArmed = false;
                wateringArmed = false;
                io.raiseEvent(
                    `[SENSOR] Soil moisture shot up to ${Math.round(m)}% and is still rising: they are pouring ` +
                        `way too much water on you. React right now, short and loud.`,
                    true,
                );
            } else if (wateringArmed && rise >= 6) {
                wateringArmed = false;
                io.raiseEvent(
                    `[SENSOR] Someone just started watering you: soil moisture went from ` +
                        `${Math.round(m - rise)}% to ${Math.round(m)}% in a few seconds.`,
                    false,
                );
            }
            // Re-arm once the soil has settled again.
            if (Math.abs(rise) < 1) {
                if (m < WET_PCT - 5) floodArmed = true;
                if (m < DRY_PCT + 10) wateringArmed = true;
            }
        },

        // Returns the tool result, or undefined if the tool is not the plant's.
        runTool(name: string, args: any): string | undefined {
            if (name === 'get_soil_moisture') {
                const m = now();
                if (m === null || Date.now() - lastSensorAt > 5000) return JSON.stringify({ error: 'sensor not reporting' });
                return JSON.stringify({
                    moisture_pct: Math.round(m),
                    change_last_5s: Math.round(m - (ago(5000) ?? m)),
                    state: state(m),
                });
            }
            if (name === 'set_face') {
                showFace(FACES.includes(args?.expression) ? args.expression : 'happy', 6000);
                return JSON.stringify({ ok: true });
            }
            return undefined;
        },

        // Called every 500 ms while idle: still dry and nobody talking -> ask again.
        tick(idleMs: number) {
            const m = now();
            if (NUDGE_S <= 0 || m === null || m >= DRY_PCT) return;
            if (idleMs < NUDGE_S * 1000 || Date.now() - lastNudgeAt < NUDGE_S * 1000) return;
            lastNudgeAt = Date.now();
            io.raiseEvent(
                `[SENSOR] Still dry: soil moisture is ${Math.round(m)}% and nobody has watered you. ` +
                    `Ask for water again, in a new way.`,
                false,
            );
        },

        // Appended to the greeting so the first words already know how the soil is.
        async greetingNote(): Promise<string> {
            await Promise.race([firstSensorSeen, new Promise((r) => setTimeout(r, 1500))]);
            const m = now();
            return m === null
                ? '\n(Your moisture sensor is not reporting yet.)'
                : `\n[SENSOR] Soil moisture right now: ${Math.round(m)}% (${state(m)}).`;
        },
    };
};
