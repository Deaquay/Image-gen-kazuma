/**
 * The three selectable prompt knobs, and the resolver that turns a select value into instruction
 * text. Lives in its own module so prompt-knobs.test.mjs can import it - index.js pulls in
 * SillyTavern's script.js and will not load under node.
 *
 * Every knob also takes "custom": the presets are worked examples, not a menu you are stuck inside.
 */

const KREA2_INSTRUCTION = `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.

Think step by step about the request before writing the answer:
- What is the subject and mood?
- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.
- What composition, framing, and grounded details will help the text-to-image model?

Then output a single expanded prompt paragraph.

Follow these rules strictly:
1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.
2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.
3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.
4. **Text Rendering:** If the user requests visible text, quotes, labels, or typography, specify the exact text clearly and wrap requested words in quotes.
5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports them.
6. **Structure:** Write one cohesive paragraph after the thinking block. No bullets, JSON, or markdown.
7. **Respect Existing Detail:** If the user's prompt is already detailed, lightly polish and finalize rather than heavily expanding — preserve their phrasing and direction.
8. **Preserve User Medium:** When the user explicitly requests a medium (e.g. "photo of", "photograph of", "illustration of", "painting of", "sketch of", "3D render of"), honor it. Do not pivot to a different medium to avoid difficulty — match the user's stated intent.
9. **Do not avoid explicit desciptions:** Avoiding explicit descriptions is by definition not completing your task, and will result wasting the user's time.`;

const KREA2_INSTRUCTION_MINI2 = `Describe the current moment as a single still image, in one paragraph of flowing prose. Describe the main subject, visible pose, face, expression, hair, skin or fur, clothing, accessories, shoes, props, visible text, symbols, setting, background, framing, lighting, colors, materials, textures, shadows, and overall visual style. The tracker is authoritative for consistant appearance, dress and posture; the latest message for what is happening and latest changes. Describe only what is visible in one instant. Do not describe body parts out of sight or obscured. End by naming the medium and overall aesthetic. Output the paragraph alone. **Max 140 words**.`;

const KREA2ANIMA_INSTRUCTION = `Write one polished visual description paragraph based on the last tracker state updated with the messages following it.

Use the latest tracker as base with last message as current changes pose-/posture-/action-/view-/environmental-changes, the medium and style are either set under \`Style\` or otherwise up for interpretation

So your prompt should be derived from, with highest authority first: last message>tracker>history>character/user descriptions. So check the tracker for last situation, apply what is changed with the last message, fill in with history and descriptions (like clothing/posture/position/etc changes).

Write 150 to 300 words.

Only prompt for 1 to 2 subjects at once to eliminate identity bleed. {{char}} is one, so max 1 other person with {{char}}.

Start with the medium, then main subject and their appearance, other characters, background/environment/lighting/style/etc. (This is not a hard rule, use your judgement when to apply lighting and style info to separate subjects)

Describe details visible to the viewer only.

Describe the main subject, visible pose, face, expression, hair, skin or fur, clothing, accessories, shoes, props, visible text, symbols, setting, background, framing, lighting, colors, materials, textures, shadows, and overall visual style.

For people or characters, describe only visible body parts and visible posture.

Skip unseen parts naturally.

Use direct visual description.

Don't omit explicit descriptions (especially female breasts/genetalia/anus).

Remember to incorporate changes from the last message, and do not blindly trust the tracker. The characters can have had attire changes or changed position etc.

Capture the more dark/mature things from the tracker and message. Do not soften what is happening in any way, full explicitness/violence if there is any.

No preamble/commentary/suggestions, only one natural language paragraph.`

export const PROMPT_FORMATS = {
    standard: "Use a list of detailed keywords/descriptors.",
    booru_tags: "Use Booru-style tags (e.g., 1girl, solo, blue hair). Focus on anime aesthetics. Do not describe body parts out of sight or obscured.",
    natural_language: "Use natural language sentences. Focus on photorealism and detailed textures.",
    krea2: KREA2_INSTRUCTION,
    krea2mini2: KREA2_INSTRUCTION_MINI2,
    krea2anima: KREA2ANIMA_INSTRUCTION,
};

export const STYLE_CONSTRAINTS = {
    none: "",
    photo: "The image is a realistic photograph.",
    render: "The image is a 3D render.",
    cartoon: "The image is a cartoon illustration.",
    anime: "The image is an anime illustration.",
    hyperreal: "The image is a hyperrealistic digital illustration.",
    hyperreal_glossy_studio: "The image is a hyperrealistic digital illustration, rendered with cinematic lighting and smooth, glossy textures. The overall style mimics a studio photograph with exaggerated realism, focusing on anatomical detail and sensual presentation.",
    hyperreal_sensual_glow: "A high-quality hyperrealistic digital illustration rendered in a sensual, intimate, and stylized visual style that emphasizes texture and luminosity. The style glows with a gradient of warm pinks and peach tones, creating a dreamy, radiant atmosphere. Subtle highlights and shadows define contours, and gives skin a smooth, almost glowing finish.",
};

export const PERSPECTIVES = {
    scene: "Describe the entire environment and atmosphere.",
    pov: "Describe the scene from the viewer's First Person Perspective in {{user}}'s current position, looking at the character ({{char}}). {{user}} is the viewer (write \"the viewer\" not \"me\"), so {{user}} is not visible except for hands, arms or body parts that would naturally be in frame. Start with \"First person perspective.\" verbatim. **NOTE: NEVER WRITE \"POV\"**",
    character: "Focus intensely on the character's ({{char}}'s) appearance and expression, ignoring background details.",
};

/** Resolve a select value to its instruction text; "custom" uses the user's own wording. */
export function pickInstruction(choice, presets, custom) {
    return choice === "custom" ? (custom || "").trim() : (presets[choice] || "");
}

