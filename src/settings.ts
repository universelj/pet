import {
  CLICK_ACTION_STATES,
  DEFAULT_ANIMATION_SETTINGS,
  DEEPSEEK_BASE_URL_STORAGE,
  DEEPSEEK_KEY_STORAGE,
  DEEPSEEK_MODEL_STORAGE,
  deleteLocalPet,
  getAllPets,
  getPetById,
  getStoredPetId,
  loadAnimationSettings,
  normalizePetManifest,
  PERSONA_STORAGE,
  PET_BROADCAST_CHANNEL,
  PET_STATE_LABELS,
  PET_STORAGE_KEY,
  saveAnimationSettings,
  saveLocalPet,
  type AnimationSettings,
  type ClickAction,
  type PetDefinition,
  type PetState,
  type RawPetManifest
} from "./pets";
import "./settings.css";

type SettingsTab = "pets" | "chat" | "motion";

function requireElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Settings element was not found: ${selector}`);
  }

  return element;
}

const listElement = requireElement<HTMLElement>("#pet-list");
const importFolderButton = requireElement<HTMLButtonElement>("#import-folder");
const folderChooser = requireElement<HTMLInputElement>("#folder-input");
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));
const petsPanelElement = requireElement<HTMLElement>("#pets-panel");
const chatPanelElement = requireElement<HTMLElement>("#chat-panel");
const motionPanelElement = requireElement<HTMLElement>("#motion-panel");
const apiKeyElement = requireElement<HTMLInputElement>("#api-key");
const rememberKeyElement = requireElement<HTMLInputElement>("#remember-key");
const modelElement = requireElement<HTMLInputElement>("#model");
const baseUrlElement = requireElement<HTMLInputElement>("#base-url");
const personaElement = requireElement<HTMLTextAreaElement>("#persona");
const aiChatEnabledElement = requireElement<HTMLInputElement>("#ai-chat-enabled");
const frameIntervalElement = requireElement<HTMLInputElement>("#frame-interval");
const clickActionElement = requireElement<HTMLSelectElement>("#click-action");
const clickPoseLoopsElement = requireElement<HTMLInputElement>("#click-pose-loops");
const responseActionLoopsElement = requireElement<HTMLInputElement>("#response-action-loops");
const minActionMsElement = requireElement<HTMLInputElement>("#min-action-ms");
const dragStartDelayElement = requireElement<HTMLInputElement>("#drag-start-delay");
const dragReleaseDelayElement = requireElement<HTMLInputElement>("#drag-release-delay");
const idlePlaysElement = requireElement<HTMLInputElement>("#idle-plays");
const resetMotionButton = requireElement<HTMLButtonElement>("#reset-motion");
const motionStateListElement = requireElement<HTMLElement>("#motion-state-list");

const petChannel = new BroadcastChannel(PET_BROADCAST_CHANNEL);
let selectedPetId = getPetById(getStoredPetId())?.id ?? "";
let animationSettings = loadAnimationSettings();

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function readNumberInput(input: HTMLInputElement, fallback: number, min: number, max: number) {
  const value = Number(input.value);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return clampNumber(value, min, max);
}

function hydrateChatSettings() {
  const savedKey = localStorage.getItem(DEEPSEEK_KEY_STORAGE);
  const savedModel = localStorage.getItem(DEEPSEEK_MODEL_STORAGE);
  const savedBaseUrl = localStorage.getItem(DEEPSEEK_BASE_URL_STORAGE);
  const savedPersona = localStorage.getItem(PERSONA_STORAGE);

  if (savedKey) {
    apiKeyElement.value = savedKey;
    rememberKeyElement.checked = true;
  }

  if (savedModel) {
    modelElement.value = savedModel;
  }

  if (savedBaseUrl) {
    baseUrlElement.value = savedBaseUrl;
  }

  if (savedPersona) {
    personaElement.value = savedPersona;
  }
}

function persistChatSettings() {
  const model = modelElement.value.trim() || "deepseek-v4-flash";
  const baseUrl = baseUrlElement.value.trim() || "https://api.deepseek.com";
  const persona = personaElement.value.trim();
  const apiKey = rememberKeyElement.checked ? apiKeyElement.value.trim() : "";

  localStorage.setItem(DEEPSEEK_MODEL_STORAGE, model);
  localStorage.setItem(DEEPSEEK_BASE_URL_STORAGE, baseUrl);
  localStorage.setItem(PERSONA_STORAGE, persona);

  if (rememberKeyElement.checked) {
    localStorage.setItem(DEEPSEEK_KEY_STORAGE, apiKeyElement.value.trim());
  } else {
    localStorage.removeItem(DEEPSEEK_KEY_STORAGE);
  }

  petChannel.postMessage({
    settingsUpdated: true,
    apiKey,
    baseUrl,
    model,
    persona
  });
}

function drawPreview(canvas: HTMLCanvasElement, pet: PetDefinition) {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const pixelRatio = window.devicePixelRatio || 1;
  const width = 96;
  const height = 104;
  const image = new Image();

  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  image.addEventListener("load", () => {
    context.clearRect(0, 0, width, height);
    context.drawImage(
      image,
      0,
      0,
      pet.manifest.atlas.cellWidth,
      pet.manifest.atlas.cellHeight,
      0,
      0,
      width,
      height
    );
  });
  image.addEventListener("error", () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#edf1f7";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#667085";
    context.font = "12px sans-serif";
    context.textAlign = "center";
    context.fillText("加载失败", width / 2, height / 2);
  });
  image.src = pet.spritesheetUrl;
}

function persistSelectedPet(petId: string) {
  selectedPetId = petId;

  if (selectedPetId) {
    localStorage.setItem(PET_STORAGE_KEY, selectedPetId);
  } else {
    localStorage.removeItem(PET_STORAGE_KEY);
  }
}

function selectPet(petId: string) {
  const nextPet = getPetById(petId);

  persistSelectedPet(nextPet?.id ?? "");
  petChannel.postMessage({ petId: selectedPetId });
  render();
  renderClickActionOptions();
  renderMotionRows();
}

function renderEmptyState() {
  const empty = document.createElement("section");
  const title = document.createElement("strong");
  const body = document.createElement("p");

  empty.className = "empty-pets";
  title.textContent = "还没有本地宠物";
  body.textContent = "点击右上角“加载文件夹”，选择包含 pet.json 和 spritesheet.webp 的文件夹。";
  empty.append(title, body);
  listElement.append(empty);
}

function deletePet(pet: PetDefinition) {
  const confirmed = window.confirm(`删除宠物“${pet.manifest.displayName}”？`);

  if (!confirmed) {
    return;
  }

  const deletedSelectedPet = selectedPetId === pet.id;
  deleteLocalPet(pet.id);

  if (deletedSelectedPet) {
    const fallbackPet = getPetById("");
    persistSelectedPet(fallbackPet?.id ?? "");
    petChannel.postMessage({ deletedPetId: pet.id, petId: selectedPetId });
  } else {
    petChannel.postMessage({ deletedPetId: pet.id });
  }

  render();
  renderMotionRows();
}

function renderPetOption(pet: PetDefinition) {
  const item = document.createElement("article");
  const preview = document.createElement("canvas");
  const text = document.createElement("span");
  const name = document.createElement("strong");
  const description = document.createElement("small");
  const actions = document.createElement("div");
  const deleteButton = document.createElement("button");

  item.className = "pet-option";
  item.dataset.selected = String(pet.id === selectedPetId);
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `选择 ${pet.manifest.displayName}`);
  name.textContent = pet.manifest.displayName;
  description.textContent =
    pet.origin === "bundled" ? `${pet.manifest.description} 内置` : `${pet.manifest.description} 本地`;
  text.append(name, description);
  actions.className = "pet-actions";

  if (pet.origin === "local") {
    deleteButton.type = "button";
    deleteButton.className = "delete-pet";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deletePet(pet);
    });
    actions.append(deleteButton);
  }

  item.append(preview, text, actions);
  item.addEventListener("click", () => selectPet(pet.id));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPet(pet.id);
    }
  });
  listElement.append(item);
  drawPreview(preview, pet);
}

function render() {
  const pets = getAllPets();

  if (selectedPetId && !pets.some((pet) => pet.id === selectedPetId)) {
    persistSelectedPet(pets[0]?.id ?? "");
  }

  listElement.replaceChildren();

  if (pets.length === 0) {
    renderEmptyState();
    return;
  }

  for (const pet of pets) {
    renderPetOption(pet);
  }
}

function getSelectedPet() {
  return getPetById(selectedPetId);
}

function getAvailableClickActions(pet: PetDefinition | null) {
  if (!pet) {
    return [...CLICK_ACTION_STATES];
  }

  const availableStates = new Set(pet.manifest.animations.map((animation) => animation.state));

  return CLICK_ACTION_STATES.filter((state) => availableStates.has(state));
}

function renderClickActionOptions() {
  const pet = getSelectedPet();
  const availableActions = getAvailableClickActions(pet);
  const fallbackAction = availableActions.includes(DEFAULT_ANIMATION_SETTINGS.clickAction as PetState)
    ? DEFAULT_ANIMATION_SETTINGS.clickAction
    : availableActions[0] ?? "random";
  const selectedAction = animationSettings.clickAction === "random" || availableActions.includes(animationSettings.clickAction as PetState)
    ? animationSettings.clickAction
    : fallbackAction;

  clickActionElement.replaceChildren();

  for (const state of availableActions) {
    const option = document.createElement("option");
    option.value = state;
    option.textContent = PET_STATE_LABELS[state] ?? state;
    clickActionElement.append(option);
  }

  const randomOption = document.createElement("option");
  randomOption.value = "random";
  randomOption.textContent = "随机";
  clickActionElement.append(randomOption);
  clickActionElement.value = selectedAction === "random" ? "random" : selectedAction;
}

function hydrateAnimationSettings() {
  aiChatEnabledElement.checked = animationSettings.aiChatEnabled;
  frameIntervalElement.value = String(animationSettings.frameIntervalMs);
  renderClickActionOptions();
  clickPoseLoopsElement.value = String(animationSettings.clickPoseLoops);
  responseActionLoopsElement.value = String(animationSettings.responseActionLoops);
  minActionMsElement.value = String(animationSettings.minActionMs);
  dragStartDelayElement.value = String(animationSettings.dragStartDelayMs);
  dragReleaseDelayElement.value = String(animationSettings.dragReleaseDelayMs);
  idlePlaysElement.checked = animationSettings.idlePlays;
  renderMotionRows();
}

function readAnimationSettingsFromForm(): AnimationSettings {
  const pet = getSelectedPet();
  const states: AnimationSettings["states"] = {};
  const clickAction = (clickActionElement.value || DEFAULT_ANIMATION_SETTINGS.clickAction) as ClickAction;

  for (const row of Array.from(motionStateListElement.querySelectorAll<HTMLElement>(".motion-state-row"))) {
    const state = row.dataset.state as PetState | undefined;

    if (!state) {
      continue;
    }

    const animation = pet?.manifest.animations.find((item) => item.state === state);
    const columns = pet?.manifest.atlas.columns ?? 8;
    const framesInput = row.querySelector<HTMLInputElement>(".motion-frames");
    const speedInput = row.querySelector<HTMLInputElement>(".motion-speed");
    const loopsInput = row.querySelector<HTMLInputElement>(".motion-loops");

    states[state] = {
      frames: framesInput ? readNumberInput(framesInput, animation?.frames ?? 1, 1, columns) : animation?.frames ?? 1,
      speed: speedInput ? readNumberInput(speedInput, 1, 0.25, 4) : 1,
      loops: loopsInput ? readNumberInput(loopsInput, animationSettings.responseActionLoops, 1, 20) : animationSettings.responseActionLoops
    };
  }

  return {
    aiChatEnabled: aiChatEnabledElement.checked,
    frameIntervalMs: readNumberInput(frameIntervalElement, DEFAULT_ANIMATION_SETTINGS.frameIntervalMs, 40, 500),
    clickAction,
    clickPoseLoops: readNumberInput(clickPoseLoopsElement, DEFAULT_ANIMATION_SETTINGS.clickPoseLoops, 1, 20),
    responseActionLoops: readNumberInput(responseActionLoopsElement, DEFAULT_ANIMATION_SETTINGS.responseActionLoops, 1, 20),
    minActionMs: readNumberInput(minActionMsElement, DEFAULT_ANIMATION_SETTINGS.minActionMs, 0, 10000),
    dragStartDelayMs: readNumberInput(dragStartDelayElement, DEFAULT_ANIMATION_SETTINGS.dragStartDelayMs, 0, 1000),
    dragReleaseDelayMs: readNumberInput(dragReleaseDelayElement, DEFAULT_ANIMATION_SETTINGS.dragReleaseDelayMs, 0, 1000),
    idlePlays: idlePlaysElement.checked,
    states
  };
}

function persistAnimationSettings() {
  animationSettings = saveAnimationSettings(readAnimationSettingsFromForm());
  petChannel.postMessage({
    animationSettingsUpdated: true,
    animationSettings
  });
}

function resetAnimationSettings() {
  animationSettings = saveAnimationSettings(DEFAULT_ANIMATION_SETTINGS);
  hydrateAnimationSettings();
  petChannel.postMessage({
    animationSettingsUpdated: true,
    animationSettings
  });
}

function renderMotionRows() {
  const pet = getSelectedPet();
  motionStateListElement.replaceChildren();

  if (!pet) {
    const empty = document.createElement("p");
    empty.className = "motion-empty";
    empty.textContent = "先选择或导入一个宠物。";
    motionStateListElement.append(empty);
    return;
  }

  for (const animation of pet.manifest.animations) {
    const stateSettings = animationSettings.states[animation.state] ?? {};
    const row = document.createElement("div");
    const name = document.createElement("strong");
    const frames = document.createElement("input");
    const speed = document.createElement("input");
    const loops = document.createElement("input");
    const previewButton = document.createElement("button");

    row.className = "motion-state-row";
    row.dataset.state = animation.state;
    name.textContent = PET_STATE_LABELS[animation.state] ?? animation.state;

    frames.className = "motion-frames";
    frames.type = "number";
    frames.min = "1";
    frames.max = String(pet.manifest.atlas.columns);
    frames.step = "1";
    frames.value = String(stateSettings.frames ?? animation.frames);
    frames.title = `最多 ${pet.manifest.atlas.columns} 帧`;

    speed.className = "motion-speed";
    speed.type = "number";
    speed.min = "0.25";
    speed.max = "4";
    speed.step = "0.05";
    speed.value = String(stateSettings.speed ?? 1);
    speed.title = "1 是默认速度，2 是两倍速";

    loops.className = "motion-loops";
    loops.type = "number";
    loops.min = "1";
    loops.max = "20";
    loops.step = "1";
    loops.value = String(stateSettings.loops ?? animationSettings.responseActionLoops);

    previewButton.type = "button";
    previewButton.className = "preview-motion";
    previewButton.textContent = "试播";
    previewButton.title = `播放${PET_STATE_LABELS[animation.state] ?? animation.state}`;
    previewButton.addEventListener("click", () => {
      petChannel.postMessage({ previewAction: animation.state });
    });

    for (const input of [frames, speed, loops]) {
      input.addEventListener("input", persistAnimationSettings);
      input.addEventListener("change", persistAnimationSettings);
    }

    row.append(name, frames, speed, loops, previewButton);
    motionStateListElement.append(row);
  }
}

function setTab(tab: SettingsTab) {
  for (const button of tabs) {
    button.dataset.active = String(button.dataset.tab === tab);
  }

  petsPanelElement.hidden = tab !== "pets";
  chatPanelElement.hidden = tab !== "chat";
  motionPanelElement.hidden = tab !== "motion";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function importPetFolder(files: FileList | null) {
  const fileArray = Array.from(files || []);
  const manifestFile = fileArray.find((file) => file.name.toLowerCase() === "pet.json");
  const spriteFile = fileArray.find((file) => /^spritesheet\.(webp|png)$/i.test(file.name));

  if (!manifestFile || !spriteFile) {
    window.alert("请选择包含 pet.json 和 spritesheet.webp 或 spritesheet.png 的文件夹。");
    return;
  }

  try {
    const manifest = JSON.parse(await manifestFile.text()) as RawPetManifest;
    const normalizedManifest = normalizePetManifest(manifest);
    const spritesheetDataUrl = await readFileAsDataUrl(spriteFile);
    const id = `local:${normalizedManifest.id}`;

    saveLocalPet({
      id,
      manifest: normalizedManifest,
      spritesheetDataUrl
    });
    selectPet(id);
    folderChooser.value = "";
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

for (const button of tabs) {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    setTab(tab === "chat" || tab === "motion" ? tab : "pets");
  });
}

importFolderButton.addEventListener("click", () => folderChooser.click());
folderChooser.setAttribute("webkitdirectory", "");
folderChooser.addEventListener("change", () => void importPetFolder(folderChooser.files));

for (const element of [modelElement, baseUrlElement, personaElement, rememberKeyElement]) {
  element.addEventListener("change", persistChatSettings);
}

for (const element of [
  aiChatEnabledElement,
  frameIntervalElement,
  clickActionElement,
  clickPoseLoopsElement,
  responseActionLoopsElement,
  minActionMsElement,
  dragStartDelayElement,
  dragReleaseDelayElement,
  idlePlaysElement
]) {
  element.addEventListener("input", persistAnimationSettings);
  element.addEventListener("change", persistAnimationSettings);
}

resetMotionButton.addEventListener("click", resetAnimationSettings);
personaElement.addEventListener("input", persistChatSettings);
apiKeyElement.addEventListener("change", persistChatSettings);
window.addEventListener("beforeunload", () => {
  petChannel.close();
});

hydrateChatSettings();
hydrateAnimationSettings();
setTab("pets");
render();
