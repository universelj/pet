import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DEEPSEEK_BASE_URL_STORAGE,
  DEEPSEEK_KEY_STORAGE,
  DEEPSEEK_MODEL_STORAGE,
  getPetById,
  getStoredPetId,
  PERSONA_STORAGE,
  PET_BROADCAST_CHANNEL,
  PET_STORAGE_KEY,
  type PetDefinition,
  type PetManifest,
  type PetRow,
  type PetState
} from "./pets";
import "./styles.css";

type PetChatMessage = { role: "user" | "assistant"; content: string };

const CHAT_HISTORY_STORAGE = "aipet:chat-history";
const CHAT_HISTORY_LIMIT = 10;

const pet = document.querySelector<HTMLCanvasElement>("#pet");
const chatArea = document.querySelector<HTMLElement>("#chat-area");
const bubbleList = document.querySelector<HTMLElement>("#bubble-list");
const chatForm = document.querySelector<HTMLFormElement>("#pet-chat-form");
const chatInput = document.querySelector<HTMLInputElement>("#pet-chat-input");
const chatSend = document.querySelector<HTMLButtonElement>("#pet-chat-send");
const closeChatButton = document.querySelector<HTMLButtonElement>("#close-chat");

if (!pet || !chatArea || !bubbleList || !chatForm || !chatInput || !chatSend || !closeChatButton) {
  throw new Error("Pet surface was not found.");
}

const petElement = pet;
const chatAreaElement = chatArea;
const bubbleListElement = bubbleList;
const chatFormElement = chatForm;
const chatInputElement = chatInput;
const chatSendElement = chatSend;
const closeChatElement = closeChatButton;
const context = petElement.getContext("2d");

if (!context) {
  throw new Error("Pet canvas context was not available.");
}

const canvasContext = context;
const petChannel = new BroadcastChannel(PET_BROADCAST_CHANNEL);
let activePet: PetDefinition | null = null;
let manifest: PetManifest | null = null;
let spritesheet: HTMLImageElement | null = null;
let currentFrame = 0;
let currentState: PetRow | null = null;
let spriteLoadToken = 0;
let animationTimer: ReturnType<typeof window.setInterval> | undefined;
let returnToIdleTimer: ReturnType<typeof window.setTimeout> | undefined;
let dragTimer: ReturnType<typeof window.setTimeout> | undefined;
let isDragging = false;
let pointerIsDown = false;
let pointerStartX = 0;
let pointerStartY = 0;
let chatHistory: PetChatMessage[] = loadChatHistory();
let petScale = parseFloat(localStorage.getItem("aipet:pet-scale") || "1.0");

function loadChatHistory(): PetChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_STORAGE);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((message): message is PetChatMessage => {
        return (
          typeof message === "object" &&
          message !== null &&
          ("role" in message && (message.role === "user" || message.role === "assistant")) &&
          ("content" in message && typeof message.content === "string")
        );
      })
      .slice(-CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persistChatHistory() {
  localStorage.setItem(CHAT_HISTORY_STORAGE, JSON.stringify(chatHistory.slice(-CHAT_HISTORY_LIMIT)));
}

function clearAnimationTimer() {
  if (animationTimer !== undefined) {
    window.clearInterval(animationTimer);
    animationTimer = undefined;
  }
}

function clearReturnTimer() {
  if (returnToIdleTimer !== undefined) {
    window.clearTimeout(returnToIdleTimer);
    returnToIdleTimer = undefined;
  }
}

function clearDragTimer() {
  if (dragTimer !== undefined) {
    window.clearTimeout(dragTimer);
    dragTimer = undefined;
  }
}

function getAnimation(state: PetState): PetRow | null {
  if (!manifest) {
    return null;
  }

  return manifest.animations.find((row) => row.state === state) ?? manifest.animations[0] ?? null;
}

function resizeCanvas() {
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.round(192 * petScale);
  const height = Math.round(208 * petScale);

  petElement.width = Math.round(width * pixelRatio);
  petElement.height = Math.round(height * pixelRatio);
  petElement.style.width = `${width}px`;
  petElement.style.height = `${height}px`;
  canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  renderFrame();
}

function setState(state: PetState) {
  const next = getAnimation(state);

  if (!next || next.state === currentState?.state) {
    return;
  }

  currentState = next;
  currentFrame = 0;
  renderFrame();
  startAnimation();
}

function playPose() {
  const poses: PetState[] = ["waving", "jumping", "review", "waiting"];
  const next = poses[Math.floor(Math.random() * poses.length)];
  const animation = getAnimation(next);

  clearReturnTimer();
  setState(next);
  returnToIdleTimer = window.setTimeout(() => setState("idle"), (animation?.frames ?? 4) * 150 * 5);
}

async function setChatOpen(open: boolean) {
  chatAreaElement.hidden = !open;

  if (!open) {
    bubbleListElement.replaceChildren();
    chatInputElement.value = "";
    chatSendElement.disabled = false;
    setState("idle");
  }

  await invoke("set_pet_chat_mode", { expanded: open, scale: petScale });
  resizeCanvas();

  if (open) {
    chatInputElement.focus();
  }
}

function addBubble(role: "user" | "assistant", content: string, className?: string) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}${className ? ` ${className}` : ""}`;
  bubble.textContent = content;

  // Remove thinking placeholder if it exists
  const thinking = bubbleListElement.querySelector(".chat-bubble.thinking");
  if (thinking && role === "assistant" && !className) {
    thinking.remove();
  }

  bubbleListElement.append(bubble);
  bubbleListElement.scrollTop = bubbleListElement.scrollHeight;

  return bubble;
}

async function openChat() {
  if (!activePet) {
    return;
  }

  playPose();
  await setChatOpen(true);
}

async function sendPetMessage() {
  if (!manifest) {
    addBubble("assistant", "请先在设置里导入一个本地宠物。");
    return;
  }

  const content = chatInputElement.value.trim();

  if (!content) {
    return;
  }

  const apiKey = localStorage.getItem(DEEPSEEK_KEY_STORAGE) || "";
  const baseUrl = localStorage.getItem(DEEPSEEK_BASE_URL_STORAGE) || "https://api.deepseek.com";
  const model = localStorage.getItem(DEEPSEEK_MODEL_STORAGE) || "deepseek-v4-flash";
  const systemPrompt =
    localStorage.getItem(PERSONA_STORAGE) ||
    `你是 ${manifest.displayName}，一个温暖、活泼的桌面宠物伙伴。用用户的语言回复，回答要短，像从宠物嘴里说出来的一句话。`;

  if (!apiKey) {
    addBubble("assistant", "先在设置里填写 DeepSeek API Key，我就能聊天了。");
    return;
  }

  chatInputElement.value = "";
  chatSendElement.disabled = true;
  addBubble("user", content);
  const thinkingBubble = addBubble("assistant", "我想一下...", "thinking");
  setState("running");

  const userMessage: PetChatMessage = { role: "user", content };
  chatHistory = [...chatHistory, userMessage].slice(-CHAT_HISTORY_LIMIT);
  persistChatHistory();

  try {
    const reply = await invoke<string>("deepseek_chat", {
      request: {
        apiKey,
        baseUrl,
        model,
        systemPrompt,
        messages: chatHistory
      }
    });

    const assistantMessage: PetChatMessage = { role: "assistant", content: reply };
    chatHistory = [...chatHistory, assistantMessage].slice(-CHAT_HISTORY_LIMIT);
    persistChatHistory();
    thinkingBubble.remove();
    addBubble("assistant", reply);
    setState("review");
    clearReturnTimer();
    returnToIdleTimer = window.setTimeout(() => setState("idle"), 1800);
  } catch (error) {
    thinkingBubble.remove();
    addBubble("assistant", error instanceof Error ? error.message : String(error));
    setState("failed");
  } finally {
    chatSendElement.disabled = false;
  }
}

function renderFrame() {
  if (!manifest || !currentState || !spritesheet || !spritesheet.complete || spritesheet.naturalWidth === 0) {
    return;
  }

  const x = currentFrame * manifest.atlas.cellWidth;
  const y = currentState.row * manifest.atlas.cellHeight;
  const width = petElement.width / (window.devicePixelRatio || 1);
  const height = petElement.height / (window.devicePixelRatio || 1);

  canvasContext.clearRect(0, 0, width, height);

  try {
    canvasContext.drawImage(
      spritesheet,
      x,
      y,
      manifest.atlas.cellWidth,
      manifest.atlas.cellHeight,
      0,
      0,
      width,
      height
    );
  } catch {
    clearAnimationTimer();
    addBubble("assistant", "这个宠物的 spritesheet 尺寸和 pet.json 不匹配。");
  }

  petElement.dataset.state = currentState.state;
}

function startAnimation() {
  clearAnimationTimer();
  if (currentState?.state === "idle") {
    currentFrame = 0;
    renderFrame();
    return;
  }
  animationTimer = window.setInterval(() => {
    const frames = Math.max(1, currentState?.frames ?? 1);
    currentFrame = (currentFrame + 1) % frames;
    renderFrame();
  }, 140);
}

function clearActivePet() {
  activePet = null;
  manifest = null;
  spritesheet = null;
  currentState = null;
  currentFrame = 0;
  spriteLoadToken += 1;
  clearAnimationTimer();
  clearReturnTimer();
  clearDragTimer();
  canvasContext.clearRect(0, 0, petElement.width, petElement.height);
  petElement.hidden = true;
  petElement.title = "请在设置里加载本地宠物";
  localStorage.removeItem(PET_STORAGE_KEY);
  void setChatOpen(false);
}

function loadPet(petDefinition: PetDefinition) {
  activePet = petDefinition;
  manifest = activePet.manifest;
  currentFrame = 0;
  currentState = getAnimation("idle");
  spritesheet = null;
  petElement.hidden = false;
  petElement.title = manifest.displayName;
  localStorage.setItem(PET_STORAGE_KEY, activePet.id);

  const token = ++spriteLoadToken;
  const nextImage = new Image();

  nextImage.addEventListener("load", () => {
    if (token !== spriteLoadToken) {
      return;
    }

    spritesheet = nextImage;
    resizeCanvas();
    renderFrame();
    startAnimation();
  });

  nextImage.addEventListener("error", () => {
    if (token !== spriteLoadToken) {
      return;
    }

    clearAnimationTimer();
    spritesheet = null;
    petElement.hidden = true;
    addBubble("assistant", "这个宠物图片加载失败，请在设置里删除后重新导入。");
  });

  nextImage.src = activePet.spritesheetUrl;
}

function switchPet(petId: string) {
  const nextPet = getPetById(petId);

  if (!nextPet) {
    clearActivePet();
    return;
  }

  if (activePet?.id === nextPet.id) {
    return;
  }

  void setChatOpen(false);
  loadPet(nextPet);
}

function beginDrag() {
  if (!pointerIsDown || isDragging || !activePet) {
    return;
  }

  isDragging = true;
  clearDragTimer();
  setState("running-right");
  void getCurrentWindow()
    .startDragging()
    .finally(() => {
      pointerIsDown = false;
      setState("idle");
      window.setTimeout(() => {
        isDragging = false;
      }, 80);
    });
}

window.addEventListener("resize", resizeCanvas);

petElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !activePet) {
    return;
  }

  pointerIsDown = true;
  isDragging = false;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  petElement.setPointerCapture(event.pointerId);
  dragTimer = window.setTimeout(beginDrag, 180);
});

petElement.addEventListener("pointermove", (event) => {
  if (!pointerIsDown || isDragging || (event.buttons & 1) !== 1) {
    return;
  }

  const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);

  if (distance > 6) {
    beginDrag();
  }
});

petElement.addEventListener("pointerup", (event) => {
  clearDragTimer();
  pointerIsDown = false;
  petElement.releasePointerCapture(event.pointerId);

  if (isDragging) {
    setState("idle");
    window.setTimeout(() => {
      isDragging = false;
    }, 80);
    return;
  }

  void openChat();
});

petElement.addEventListener("pointercancel", () => {
  clearDragTimer();
  pointerIsDown = false;
  isDragging = false;
  setState("idle");
});

window.addEventListener("storage", (event) => {
  if (event.key === PET_STORAGE_KEY) {
    switchPet(event.newValue || "");
  }
});

petChannel.addEventListener("message", (event: MessageEvent<{ petId?: string; deletedPetId?: string }>) => {
  if (event.data.deletedPetId && event.data.deletedPetId === activePet?.id) {
    switchPet("");
    return;
  }

  if (event.data.petId !== undefined) {
    switchPet(event.data.petId);
  }
});

window.addEventListener("beforeunload", () => {
  petChannel.close();
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chatAreaElement.hidden) {
    void setChatOpen(false);
  }
});

closeChatElement.addEventListener("click", () => {
  void setChatOpen(false);
});

chatFormElement.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendPetMessage();
});

function updatePetScale(newScale: number) {
  petScale = Math.min(2.0, Math.max(0.5, newScale));
  localStorage.setItem("aipet:pet-scale", String(petScale));
  document.documentElement.style.setProperty("--pet-scale", String(petScale));

  void invoke("set_pet_chat_mode", {
    expanded: !chatAreaElement.hidden,
    scale: petScale
  }).then(() => {
    resizeCanvas();
  });
}

petElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  const zoomFactor = event.deltaY < 0 ? 0.05 : -0.05;
  updatePetScale(petScale + zoomFactor);
}, { passive: false });

chatAreaElement.hidden = true;
updatePetScale(petScale);

const initialPet = getPetById(getStoredPetId());

if (initialPet) {
  loadPet(initialPet);
} else {
  clearActivePet();
}
