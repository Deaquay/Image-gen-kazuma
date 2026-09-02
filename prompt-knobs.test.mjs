// Run: node prompt-knobs.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { PERSPECTIVES, PROMPT_FORMATS, STYLE_CONSTRAINTS, pickInstruction } from "./prompt-knobs.js";

const PRESETS = { none: "", standard: "keywords", anime: "anime illustration" };

assert.strictEqual(pickInstruction("anime", PRESETS, "ignored"), "anime illustration");
// custom wins over the presets, and is trimmed
assert.strictEqual(pickInstruction("custom", PRESETS, "  watercolour  "), "watercolour");
// a blank custom box resolves empty, so the caller can fall back or drop the line
assert.strictEqual(pickInstruction("custom", PRESETS, "   "), "");
assert.strictEqual(pickInstruction("custom", PRESETS, undefined), "");
// "none" and an unknown value are both empty
assert.strictEqual(pickInstruction("none", PRESETS, ""), "");
assert.strictEqual(pickInstruction("bogus", PRESETS, ""), "");

// The real failure mode: an <option value> in example.html with no matching preset key silently
// generates with an empty instruction. Adding a preset means touching both files.
const html = readFileSync(new URL("./example.html", import.meta.url), "utf8");
const optionsOf = (id) => {
    const select = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`))?.[1];
    assert.ok(select, `no <select id="${id}"> in example.html`);
    return [...select.matchAll(/value="([^"]+)"/g)].map(m => m[1]).filter(v => v !== "custom");
};
for (const [id, presets] of [
    ["kazuma_prompt_style", PROMPT_FORMATS],
    ["kazuma_style_constraint", STYLE_CONSTRAINTS],
    ["kazuma_prompt_persp", PERSPECTIVES],
]) {
    assert.deepStrictEqual(optionsOf(id).sort(), Object.keys(presets).sort(), `${id} options vs presets`);
}

// Every select also offers Custom, and has a matching custom input to reveal.
for (const id of ["kazuma_prompt_style", "kazuma_style_constraint", "kazuma_prompt_persp"]) {
    assert.ok(html.includes(`<select id="${id}"`) && html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0].includes('value="custom"'), `${id} has no Custom option`);
    assert.ok(html.includes(`id="${id}_custom"`), `${id}_custom input missing`);
}

console.log("prompt-knobs: ok");
