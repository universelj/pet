use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

const PET_COLLAPSED_WIDTH: u32 = 192;
const PET_COLLAPSED_HEIGHT: u32 = 208;
const PET_EXPANDED_HEIGHT: u32 = 360;
const SCREEN_MARGIN: i32 = 24;

struct AppState {
    http_client: reqwest::Client,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeepSeekRequest {
    api_key: String,
    base_url: String,
    model: String,
    system_prompt: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, serde::Serialize)]
struct DeepSeekApiRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
}

#[derive(Debug, serde::Deserialize)]
struct DeepSeekApiResponse {
    choices: Vec<DeepSeekChoice>,
}

#[derive(Debug, serde::Deserialize)]
struct DeepSeekChoice {
    message: ChatMessage,
}

pub fn run() {
    let http_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("reqwest client should be created");

    tauri::Builder::default()
        .manage(AppState { http_client })
        .invoke_handler(tauri::generate_handler![deepseek_chat, set_pet_chat_mode])
        .setup(|app| {
            let app_handle = app.handle();
            let window = app
                .get_webview_window("main")
                .expect("main window should exist");

            let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
            let _ = window.set_shadow(false);
            place_window_bottom_right(&window, PET_COLLAPSED_WIDTH, PET_COLLAPSED_HEIGHT);
            build_tray(app_handle)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AIPet");
}

#[tauri::command]
fn set_pet_chat_mode(app: AppHandle, expanded: bool, scale: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("Pet window was not found.".into());
    };
    let _ = window.set_shadow(false);

    let (width, height) = if expanded {
        let scaled_pet_width = (PET_COLLAPSED_WIDTH as f64 * scale).round() as u32;
        let scaled_pet_height = (PET_COLLAPSED_HEIGHT as f64 * scale).round() as u32;
        let w = 428 + scaled_pet_width;
        let h = u32::max(PET_EXPANDED_HEIGHT, scaled_pet_height + 20);
        (w, h)
    } else {
        let w = (PET_COLLAPSED_WIDTH as f64 * scale).round() as u32;
        let h = (PET_COLLAPSED_HEIGHT as f64 * scale).round() as u32;
        (w, h)
    };

    resize_pet_window_keep_anchor(&window, width, height);
    Ok(())
}

#[tauri::command]
async fn deepseek_chat(
    state: tauri::State<'_, AppState>,
    request: DeepSeekRequest,
) -> Result<String, String> {
    let api_key = request.api_key.trim();
    let base_url = request.base_url.trim().trim_end_matches('/');
    let model = request.model.trim();

    if api_key.is_empty() {
        return Err("DeepSeek API key is required.".into());
    }

    if base_url.is_empty() {
        return Err("DeepSeek base URL is required.".into());
    }

    if model.is_empty() {
        return Err("DeepSeek model is required.".into());
    }

    let mut messages = Vec::new();

    if !request.system_prompt.trim().is_empty() {
        messages.push(ChatMessage {
            role: "system".into(),
            content: request.system_prompt.trim().into(),
        });
    }

    messages.extend(request.messages);

    let response = state
        .http_client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .json(&DeepSeekApiRequest {
            model: model.into(),
            messages,
            temperature: 0.8,
        })
        .send()
        .await
        .map_err(|error| format!("DeepSeek 请求失败：{error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("DeepSeek 返回 {status}: {body}"));
    }

    let payload = response
        .json::<DeepSeekApiResponse>()
        .await
        .map_err(|error| format!("DeepSeek 响应解析失败：{error}"))?;

    payload
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "DeepSeek 返回了空回复。".into())
}

fn place_window_bottom_right(window: &WebviewWindow, width: u32, height: u32) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };

    let (scaled_width, scaled_height) = scaled_window_size(window, width, height);
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let x = monitor_position.x + monitor_size.width as i32 - scaled_width as i32 - SCREEN_MARGIN;
    let y = monitor_position.y + monitor_size.height as i32 - scaled_height as i32 - SCREEN_MARGIN;

    let _ = window.set_size(PhysicalSize::new(scaled_width, scaled_height));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn resize_pet_window_keep_anchor(window: &WebviewWindow, width: u32, height: u32) {
    let (scaled_width, scaled_height) = scaled_window_size(window, width, height);
    let Ok(position) = window.outer_position() else {
        let _ = window.set_size(PhysicalSize::new(scaled_width, scaled_height));
        return;
    };
    let Ok(size) = window.outer_size() else {
        let _ = window.set_size(PhysicalSize::new(scaled_width, scaled_height));
        return;
    };

    let anchor_x = i64::from(position.x) + i64::from(size.width);
    let anchor_y = i64::from(position.y) + i64::from(size.height);
    let next_x = clamp_i64_to_i32(anchor_x - i64::from(scaled_width));
    let next_y = clamp_i64_to_i32(anchor_y - i64::from(scaled_height));

    let _ = window.set_size(PhysicalSize::new(scaled_width, scaled_height));
    let _ = window.set_position(PhysicalPosition::new(next_x, next_y));
}

fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn scaled_window_size(window: &WebviewWindow, width: u32, height: u32) -> (u32, u32) {
    let scale = window.scale_factor().unwrap_or(1.0);

    (
        (width as f64 * scale).round() as u32,
        (height as f64 * scale).round() as u32,
    )
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show-hide", "显示 / 隐藏", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_hide, &settings, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("桌宠")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-hide" => toggle_main_window(app),
            "settings" => show_settings_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_settings_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("settings") else {
        return;
    };

    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => {
            let _ = window.show();
        }
    }
}
