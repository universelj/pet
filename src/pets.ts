import miaomiaoManifest from "./assets/pet/pet.json";
import miaomiaoSpritesheet from "./assets/pet/spritesheet.webp";

export type PetState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type ClickAction = PetState | "random";

export const PET_STATE_ORDER: readonly PetState[] = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review"
];

export const CLICK_ACTION_STATES: readonly PetState[] = PET_STATE_ORDER;

export const PET_STATE_LABELS: Record<PetState, string> = {
  idle: "待机",
  "running-right": "向右移动",
  "running-left": "向左移动",
  waving: "打招呼",
  jumping: "跳跃",
  failed: "哭泣/失败",
  waiting: "歪头/等待",
  running: "处理中",
  review: "认真回复"
};

export type PetRow = {
  state: PetState;
  row: number;
  frames: number;
};

export type PetManifest = {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  atlas: {
    cellWidth: number;
    cellHeight: number;
    columns: number;
    rows: number;
  };
  animations: PetRow[];
};

export type RawPetManifest = Partial<PetManifest> & {
  display_name?: unknown;
};

export type PetDefinition = {
  id: string;
  manifest: PetManifest;
  spritesheetUrl: string;
  origin: "bundled" | "local";
};

export type StoredLocalPet = {
  id: string;
  manifest: RawPetManifest;
  spritesheetDataUrl: string;
};

export type AnimationStateSettings = {
  frames?: number;
  speed?: number;
  loops?: number;
};

export type AnimationSettings = {
  aiChatEnabled: boolean;
  frameIntervalMs: number;
  clickAction: ClickAction;
  clickPoseLoops: number;
  responseActionLoops: number;
  minActionMs: number;
  dragStartDelayMs: number;
  dragReleaseDelayMs: number;
  idlePlays: boolean;
  states: Partial<Record<PetState, AnimationStateSettings>>;
};

const DEFAULT_ATLAS = {
  cellWidth: 192,
  cellHeight: 208,
  columns: 8,
  rows: 9
};

const DEFAULT_ANIMATIONS: PetRow[] = [
  { state: "idle", row: 0, frames: 6 },
  { state: "running-right", row: 1, frames: 8 },
  { state: "running-left", row: 2, frames: 8 },
  { state: "waving", row: 3, frames: 4 },
  { state: "jumping", row: 4, frames: 5 },
  { state: "failed", row: 5, frames: 8 },
  { state: "waiting", row: 6, frames: 6 },
  { state: "running", row: 7, frames: 6 },
  { state: "review", row: 8, frames: 6 }
];

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  aiChatEnabled: true,
  frameIntervalMs: 140,
  clickAction: "waving",
  clickPoseLoops: 5,
  responseActionLoops: 4,
  minActionMs: 1600,
  dragStartDelayMs: 180,
  dragReleaseDelayMs: 80,
  idlePlays: false,
  states: {}
};

export const BUNDLED_PETS: PetDefinition[] = [
  {
    id: "miaomiao",
    manifest: normalizePetManifest(miaomiaoManifest as RawPetManifest),
    spritesheetUrl: miaomiaoSpritesheet,
    origin: "bundled"
  }
];

export const PET_STORAGE_KEY = "aipet:selected-pet";
export const PET_BROADCAST_CHANNEL = "aipet-pet";
export const CUSTOM_PETS_STORAGE_KEY = "aipet:custom-pets";
export const DEEPSEEK_KEY_STORAGE = "aipet:deepseek-api-key";
export const DEEPSEEK_MODEL_STORAGE = "aipet:deepseek-model";
export const DEEPSEEK_BASE_URL_STORAGE = "aipet:deepseek-base-url";
export const PERSONA_STORAGE = "aipet:pet-persona";
export const ANIMATION_SETTINGS_STORAGE = "aipet:animation-settings";
export const PET_SCALE_STORAGE = "aipet:pet-scale";

function hasUsableSpriteData(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(png|webp);base64,/i.test(value);
}

function sanitizeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "local-pet";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(next)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, next));
}

export function isPetState(value: unknown): value is PetState {
  return typeof value === "string" && PET_STATE_ORDER.includes(value as PetState);
}

export function isClickAction(value: unknown): value is ClickAction {
  return value === "random" || isPetState(value);
}

function readStoredLocalPets(strict = false): StoredLocalPet[] {
  const raw = localStorage.getItem(CUSTOM_PETS_STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("本地宠物数据格式不正确。");
    }

    return parsed.filter((pet): pet is StoredLocalPet => {
      return (
        isObject(pet) &&
        typeof pet.id === "string" &&
        isObject(pet.manifest) &&
        hasUsableSpriteData(pet.spritesheetDataUrl)
      );
    });
  } catch (error) {
    if (strict) {
      throw error;
    }

    console.warn("本地宠物数据读取失败。", error);
    return [];
  }
}

export function normalizePetManifest(input: RawPetManifest): PetManifest {
  const snakeName = typeof input.display_name === "string" ? input.display_name.trim() : "";
  const fallbackName = snakeName || "本地宠物";
  const idSource = typeof input.id === "string" && input.id.trim() ? input.id.trim() : fallbackName;
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim()
      : fallbackName;
  const description =
    typeof input.description === "string" && input.description.trim()
      ? input.description.trim()
      : "一个从本地导入的桌宠。";
  const atlas = isObject(input.atlas) ? input.atlas : {};

  return {
    id: sanitizeId(idSource),
    displayName,
    description,
    spritesheetPath:
      typeof input.spritesheetPath === "string" && input.spritesheetPath.trim()
        ? input.spritesheetPath.trim()
        : "spritesheet.webp",
    atlas: {
      ...DEFAULT_ATLAS,
      ...atlas
    },
    animations: Array.isArray(input.animations) && input.animations.length > 0 ? input.animations : DEFAULT_ANIMATIONS
  };
}

export function normalizeAnimationSettings(input: unknown): AnimationSettings {
  const source = isObject(input) ? input : {};
  const rawStates = isObject(source.states) ? source.states : {};
  const states: Partial<Record<PetState, AnimationStateSettings>> = {};

  for (const animation of DEFAULT_ANIMATIONS) {
    const rawState = rawStates[animation.state];

    if (!isObject(rawState)) {
      continue;
    }

    states[animation.state] = {
      frames: clampNumber(rawState.frames, animation.frames, 1, DEFAULT_ATLAS.columns),
      speed: clampNumber(rawState.speed, 1, 0.25, 4),
      loops: clampNumber(rawState.loops, DEFAULT_ANIMATION_SETTINGS.responseActionLoops, 1, 20)
    };
  }

  return {
    aiChatEnabled:
      typeof source.aiChatEnabled === "boolean"
        ? source.aiChatEnabled
        : DEFAULT_ANIMATION_SETTINGS.aiChatEnabled,
    frameIntervalMs: clampNumber(
      source.frameIntervalMs,
      DEFAULT_ANIMATION_SETTINGS.frameIntervalMs,
      40,
      500
    ),
    clickAction: isClickAction(source.clickAction)
      ? source.clickAction
      : DEFAULT_ANIMATION_SETTINGS.clickAction,
    clickPoseLoops: clampNumber(
      source.clickPoseLoops,
      DEFAULT_ANIMATION_SETTINGS.clickPoseLoops,
      1,
      20
    ),
    responseActionLoops: clampNumber(
      source.responseActionLoops,
      DEFAULT_ANIMATION_SETTINGS.responseActionLoops,
      1,
      20
    ),
    minActionMs: clampNumber(source.minActionMs, DEFAULT_ANIMATION_SETTINGS.minActionMs, 0, 10000),
    dragStartDelayMs: clampNumber(
      source.dragStartDelayMs,
      DEFAULT_ANIMATION_SETTINGS.dragStartDelayMs,
      0,
      1000
    ),
    dragReleaseDelayMs: clampNumber(
      source.dragReleaseDelayMs,
      DEFAULT_ANIMATION_SETTINGS.dragReleaseDelayMs,
      0,
      1000
    ),
    idlePlays: typeof source.idlePlays === "boolean" ? source.idlePlays : DEFAULT_ANIMATION_SETTINGS.idlePlays,
    states
  };
}

export function loadAnimationSettings(): AnimationSettings {
  try {
    const raw = localStorage.getItem(ANIMATION_SETTINGS_STORAGE);
    return normalizeAnimationSettings(raw ? JSON.parse(raw) : {});
  } catch (error) {
    console.warn("动作设置读取失败。", error);
    return DEFAULT_ANIMATION_SETTINGS;
  }
}

export function saveAnimationSettings(settings: AnimationSettings) {
  const normalized = normalizeAnimationSettings(settings);
  localStorage.setItem(ANIMATION_SETTINGS_STORAGE, JSON.stringify(normalized));
  return normalized;
}

export function loadLocalPets(): PetDefinition[] {
  return readStoredLocalPets().map((pet) => {
    const manifest = normalizePetManifest(pet.manifest);

    return {
      id: pet.id || `local:${manifest.id}`,
      manifest,
      spritesheetUrl: pet.spritesheetDataUrl,
      origin: "local" as const
    };
  });
}

export function getAllPets() {
  return [...BUNDLED_PETS, ...loadLocalPets()];
}

export function saveLocalPet(pet: StoredLocalPet) {
  if (!hasUsableSpriteData(pet.spritesheetDataUrl)) {
    throw new Error("宠物 spritesheet 必须是 PNG 或 WebP 图片。");
  }

  const manifest = normalizePetManifest(pet.manifest);
  const id = pet.id || `local:${manifest.id}`;
  const existing = readStoredLocalPets(true).filter((item) => item.id !== id);
  const next: StoredLocalPet[] = [
    ...existing,
    {
      id,
      manifest,
      spritesheetDataUrl: pet.spritesheetDataUrl
    }
  ];

  localStorage.setItem(CUSTOM_PETS_STORAGE_KEY, JSON.stringify(next));
}

export function deleteLocalPet(id: string) {
  const next = readStoredLocalPets(true).filter((item) => item.id !== id);
  localStorage.setItem(CUSTOM_PETS_STORAGE_KEY, JSON.stringify(next));
}

export function getStoredPetId() {
  return localStorage.getItem(PET_STORAGE_KEY) || BUNDLED_PETS[0].id;
}

export function getPetById(id: string): PetDefinition | null {
  const pets = getAllPets();

  return pets.find((pet) => pet.id === id) ?? pets[0] ?? null;
}
