---
name: reference-character-pet
description: Use when creating, repairing, or app-integrating an importable local desktop pet for this Tauri AIPet app from a strict visual reference. Covers identity preservation, hatch-pet-style 9-state spritesheets, pet.json packaging, motion QA, Settings action triggers, AI action tags, local import/delete behavior, and privacy-safe handling of user photos or custom pets.
---

# Reference Character Pet

Use this skill when the user wants a local desktop pet made from a supplied character image or real pet photo and says it must look like the reference. The priority is:

1. preserve the reference identity;
2. make every motion state visually distinct;
3. package it so this app can load it;
4. verify every state is triggerable in the app.

## Hard Rules

- Treat the user-provided finished character image as the visual source of truth.
- Do not redesign into a generic chibi, icon, mascot, vector doll, simplified round-headed figure, or unrelated breed/species unless the user explicitly asks.
- Preserve face shape, hair/fur silhouette, markings, colors, clothes or no-clothes constraint, illustration style, and body proportions across every pose.
- Generate or edit poses on a flat chroma-key background, then remove the background locally.
- Never commit user photos, generated portraits, local pet packages, API keys, or absolute private source paths.
- Keep the import package local-only unless the user explicitly asks to publish it.
- If the user says a result does not look like the reference, treat that as a blocking QA failure and repair identity before adding more motion.

## Expected App Package

Create a folder that can be loaded from the app settings:

```text
local-pets/<name>/
  pet.json
  spritesheet.webp
```

The atlas should follow this app's current contract:

```text
cell: 192 x 208
columns: 8
rows: 9
states: idle, running-right, running-left, waving, jumping, failed, waiting, running, review
```

Use `spritesheet.webp` when validation passes. Use PNG only as an intermediate or fallback. `pet.json` must describe the actual rows and frame counts:

```json
{
  "id": "dun-dun",
  "displayName": "墩墩",
  "description": "Strict-reference local desktop pet.",
  "spritesheetPath": "spritesheet.webp",
  "atlas": {
    "cellWidth": 192,
    "cellHeight": 208,
    "columns": 8,
    "rows": 9
  },
  "animations": [
    { "state": "idle", "row": 0, "frames": 6 },
    { "state": "running-right", "row": 1, "frames": 8 },
    { "state": "running-left", "row": 2, "frames": 8 },
    { "state": "waving", "row": 3, "frames": 4 },
    { "state": "jumping", "row": 4, "frames": 5 },
    { "state": "failed", "row": 5, "frames": 8 },
    { "state": "waiting", "row": 6, "frames": 6 },
    { "state": "running", "row": 7, "frames": 6 },
    { "state": "review", "row": 8, "frames": 6 }
  ]
}
```

Do not put frames in the sheet that are absent from `pet.json`. Do not put states in `pet.json` that the sheet does not contain.

## Pose Guidance

For strict-reference person or animal pets, create a pose sheet with separated full-body poses:

- `idle`: stable standing, no constant wobble.
- `running-right`: clear right-facing walk/run pose.
- `running-left`: clear left-facing walk/run pose.
- `waving`: arm visibly raised, with at least one standing frame and one raised-hand frame.
- `jumping`: whole body visible, leave top padding for raised hands.
- `failed`: crying or sad pose; tears must stay attached to the face.
- `waiting`: curious/listening pose, distinct from idle.
- `running`: focused/thinking/processing pose for "working", not literal sprinting unless the user wants movement.
- `review`: serious reply, explanation, happy reply, or focused review pose, distinct from idle.

Avoid:

- Crouch-only "animations" made by moving the same image.
- Static rows where every frame is identical. `idle` may be calm, but it still needs intentional frame choice.
- Constant rotation, scaling, or bobbing that makes the pet visually annoying.
- Jump frames that clip hands or head.
- Semi-transparent blending between different poses; it creates ghosting.
- Shadows, floors, props, text, bubbles, labels, or scenic backgrounds.
- Random pose drift where each frame changes identity, scale, breed, clothing, or facial structure.

## Animation Assembly

Use pose changes, not whole-character shake, to show motion.

Recommended frame patterns:

- `idle`: repeat standing frames; keep still.
- `waving`: standing -> waving -> waving -> standing.
- `jumping`: use the jump pose with small vertical offsets only, and fit it smaller than other poses.
- `failed`: standing -> crying -> crying -> crying -> standing -> crying...
- `waiting`: standing -> waiting -> waiting -> waiting -> standing.
- `running` / `review`: alternate between two meaningful poses.
- `running-right` / `running-left`: alternate feet or body lean; direction must be obvious.

Keep offsets small. If a pose has raised arms, fit it with extra top margin before adding any vertical movement.

## App Integration Rules

The app must not only display the pet; it must expose and play every useful state.

- Make the Settings action selector dynamic from the active pet's `manifest.animations`; do not hard-code only `waving`, `jumping`, and `waiting`.
- Allow `clickAction` to use any `PetState` plus `random`.
- Keep a per-state `试播`/preview trigger in Settings so every row can be tested without AI.
- When the same action is triggered twice, restart from frame 0 so the user can see the motion.
- Random click action should choose from actual available manifest states, usually excluding `idle`.
- AI replies should request and parse tags only from the active pet's available states, for example `[failed]` or `[review]`.
- Strip the action tag from chat text before showing or saving the assistant reply.
- Keep state labels centralized so `review` cannot be mislabeled as an unrelated click-only action.
- Expose frame count, speed multiplier, loop count, minimum duration, drag delay, idle playback, and AI chat on/off in Settings.
- If a custom pet lacks a state, do not show that state as selectable for that pet.

## State Trigger Semantics

Use these meanings when wiring Settings and AI prompts:

- `idle`: calm neutral presence.
- `running-right`: moving or dragging toward the right.
- `running-left`: moving or dragging toward the left.
- `waving`: greeting, thanks, approval, friendly or happy acknowledgement.
- `jumping`: excitement, cheering, playful high energy.
- `failed`: sadness, apology, frustration, crying, or failure.
- `waiting`: curious, listening, asking, expecting user input.
- `running`: thinking, busy, processing, working.
- `review`: serious explanation, focused reply, careful analysis, or speaking posture.

Do not collapse `waving`, `review`, `failed`, and `waiting` into one generic happy pose. If the atlas shows a row, the user needs a way to trigger it.

## QA Checklist

Before handing off:

1. Open the contact sheet and inspect all 9 rows.
2. Confirm each row preserves the same reference identity.
3. Confirm `waving`, `failed`, `waiting`, `running`, and `review` are not static rows.
4. Confirm `idle` is stable and not distracting.
5. Confirm `jumping` does not clip the top of the cell.
6. Validate the final atlas with the hatch-pet validator.
7. Import the package from Settings with "加载文件夹".
8. Use Settings -> 动作 -> 每个动作 -> 试播 for every available state.
9. Confirm "点击宠物动作" lists all states present in `pet.json`, plus `随机`.
10. Confirm AI chat can trigger `[waving]`, `[jumping]`, `[failed]`, `[waiting]`, `[running]`, and `[review]` when enabled.
11. Make sure the final `pet.json` display name matches the user's requested name.
12. Make sure local/private source images and generated work folders are ignored by git.

## Privacy Notes

This project may use real child photos or user-supplied personal images as references. Keep these out of git:

- `local-pets/`
- `hatch-runs/`
- `tmp/`
- `generated_images/`
- `generated-images/`
- `source-images/`
- `input-images/`
- `private-assets/`
- ad hoc generation scripts with absolute paths
- downloaded or generated source pose sheets
- `.env`, API keys, chat logs, and app local data dumps

If a reusable workflow is needed, write generic instructions or parameterized scripts instead of preserving a one-off script with a personal file path.
