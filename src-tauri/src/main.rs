// Mencegah munculnya jendela console terminal di Windows saat mode rilis
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use battery::Manager as BatteryManager;
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::c_void;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

use base64::Engine as _;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::{DataReader, IInputStream};
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};
use windows::Win32::Foundation::{FILETIME, GlobalFree, HANDLE, HGLOBAL, HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BitBlt, CAPTUREBLT, CreateCompatibleBitmap, CreateCompatibleDC,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HGDIOBJ, ReleaseDC, SRCCOPY,
    SelectObject,
};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IMMDeviceEnumerator, MMDeviceEnumerator, eCapture, eConsole, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, CoInitialize, CoUninitialize};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    SetClipboardData,
};
use windows::Win32::System::Memory::{
    GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::System::SystemInformation::{
    GetTickCount, GlobalMemoryStatusEx, MEMORYSTATUSEX,
};
use windows::Win32::System::Threading::GetSystemTimes;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetKeyState, GetLastInputInfo, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
    KEYEVENTF_KEYUP, LASTINPUTINFO, SendInput, VIRTUAL_KEY, VK_C, VK_CAPITAL, VK_CONTROL, VK_LWIN,
    VK_NUMLOCK, VK_S, VK_SCROLL, VK_SHIFT, VK_V, VK_X,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_STYLE, GetClassNameW, GetForegroundWindow, GetSystemMetrics, GetWindowLongW, GetWindowRect,
    HWND_TOPMOST, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, SetWindowLongW, SetWindowPos, WS_CAPTION,
    WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
};
use windows::core::ComInterface;
mod models;
use models::*;

static APP_SETTINGS_PATH: OnceLock<PathBuf> = OnceLock::new();
static APP_SETTINGS_LOCK: Mutex<()> = Mutex::new(());
static APP_SETTINGS_CACHE: Mutex<Option<AppSettings>> = Mutex::new(None);
static PENDING_SNIP_CAPTURE: Mutex<Option<(Instant, u32)>> = Mutex::new(None);
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static AUTO_HIDE_FULLSCREEN: AtomicBool = AtomicBool::new(true);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CLICKUP_API_BASE: &str = "https://api.clickup.com/api/v2";

fn command_no_window(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn app_settings_path() -> Result<&'static PathBuf, String> {
    APP_SETTINGS_PATH
        .get()
        .ok_or_else(|| "Lokasi settings.json belum diinisialisasi".to_string())
}

fn read_settings_unlocked() -> Result<AppSettings, String> {
    if let Ok(cache) = APP_SETTINGS_CACHE.lock() {
        if let Some(settings) = cache.as_ref() {
            return Ok(settings.clone());
        }
    }

    let path = app_settings_path()?;
    let settings = if !path.is_file() {
        AppSettings::default()
    } else {
        let contents = fs::read_to_string(path)
            .map_err(|error| format!("Tidak dapat membaca settings.json: {error}"))?;
        let mut settings: AppSettings = serde_json::from_str(&contents)
            .map_err(|error| format!("Format settings.json tidak valid: {error}"))?;
        for (key, value) in AppSettings::default().preferences {
            settings.preferences.entry(key).or_insert(value);
        }
        settings
    };

    if let Ok(mut cache) = APP_SETTINGS_CACHE.lock() {
        *cache = Some(settings.clone());
    }
    Ok(settings)
}

fn write_settings_unlocked(settings: &AppSettings) -> Result<(), String> {
    let path = app_settings_path()?;
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Tidak dapat menyusun settings.json: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, &contents)
        .map_err(|error| format!("Tidak dapat menyimpan settings.json: {error}"))?;
    if let Err(rename_error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        fs::write(path, contents).map_err(|error| {
            format!("Tidak dapat menyimpan settings.json: {rename_error}; {error}")
        })?;
    }
    if let Ok(mut cache) = APP_SETTINGS_CACHE.lock() {
        *cache = Some(settings.clone());
    }
    Ok(())
}

fn read_app_settings() -> Result<AppSettings, String> {
    let _guard = APP_SETTINGS_LOCK
        .lock()
        .map_err(|_| "Pengunci settings.json gagal".to_string())?;
    read_settings_unlocked()
}

fn update_app_settings<T>(
    update: impl FnOnce(&mut AppSettings) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = APP_SETTINGS_LOCK
        .lock()
        .map_err(|_| "Pengunci settings.json gagal".to_string())?;
    let mut settings = read_settings_unlocked()?;
    let result = update(&mut settings)?;
    write_settings_unlocked(&settings)?;
    Ok(result)
}

fn parse_clickup_list_ids(value: &str) -> Result<Vec<String>, String> {
    let list_ids = value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if list_ids.is_empty()
        || list_ids
            .iter()
            .any(|id| !id.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Masukkan satu atau beberapa List ID numerik, dipisahkan koma".to_string());
    }
    Ok(list_ids)
}

fn parse_legacy_clickup_settings(contents: &str) -> Result<HashMap<String, String>, String> {
    let contents = contents.strip_prefix('\u{feff}').unwrap_or(contents);
    let mut values = HashMap::new();
    for entry in dotenvy::from_read_iter(contents.as_bytes()) {
        let (key, value) = entry.map_err(|_| {
            "Format konfigurasi ClickUp lama tidak valid; periksa sintaks file .env.".to_string()
        })?;
        if key == "CLICKUP_API_KEY" || key == "CLICKUP_LIST_IDS" {
            values.insert(key, value);
        }
    }
    Ok(values)
}

fn read_clickup_token() -> Result<String, String> {
    let token = read_app_settings()?.click_up.api_key;
    if !token.trim().starts_with("pk_") {
        return Err("API key ClickUp belum diatur di settings.json".to_string());
    }
    Ok(token.trim().to_string())
}

fn read_clickup_list_ids() -> Result<Vec<String>, String> {
    let list_ids = read_app_settings()?.click_up.list_ids;
    if list_ids
        .iter()
        .any(|id| id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("List ID ClickUp di settings.json harus berupa angka".to_string());
    }
    Ok(list_ids)
}

fn validate_clickup_list_id(list_id: &str) -> Result<(), String> {
    if list_id.is_empty() || !list_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("List ID ClickUp harus berupa angka".to_string());
    }
    if !read_clickup_list_ids()?
        .iter()
        .any(|configured| configured == list_id)
    {
        return Err("List ID tidak terdaftar di settings.json".to_string());
    }
    Ok(())
}

#[tauri::command]
fn load_app_settings() -> Result<HashMap<String, serde_json::Value>, String> {
    Ok(read_app_settings()?.preferences)
}

#[tauri::command]
fn migrate_legacy_settings(
    legacy_preferences: HashMap<String, serde_json::Value>,
) -> Result<HashMap<String, serde_json::Value>, String> {
    update_app_settings(|settings| {
        for (key, value) in legacy_preferences {
            if key.starts_with("di-") {
                if settings.legacy_preferences_migrated {
                    settings.preferences.entry(key).or_insert(value);
                } else {
                    settings.preferences.insert(key, value);
                }
            }
        }
        settings.legacy_preferences_migrated = true;
        Ok(settings.preferences.clone())
    })
}

#[tauri::command]
fn save_app_setting(key: String, value: serde_json::Value) -> Result<(), String> {
    if !key.starts_with("di-") {
        return Err("Nama pengaturan aplikasi tidak valid".to_string());
    }
    let _guard = APP_SETTINGS_LOCK
        .lock()
        .map_err(|_| "Pengunci settings.json gagal".to_string())?;
    let mut settings = read_settings_unlocked()?;
    if settings.preferences.get(&key) == Some(&value) {
        return Ok(());
    }
    settings.preferences.insert(key, value);
    write_settings_unlocked(&settings)
}

fn validate_clickup_api_key(token: &str) -> Result<(), String> {
    if !token.trim().starts_with("pk_") || token.contains(['\r', '\n']) {
        return Err("API key bukan Personal API Token ClickUp yang valid".to_string());
    }
    Ok(())
}

async fn clickup_response(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    let response = request
        .send()
        .await
        .map_err(|_| "Tidak dapat menghubungi API ClickUp".to_string())?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    Err(match status.as_u16() {
        401 => "Token ClickUp tidak valid atau sudah dicabut".to_string(),
        403 => "Token ClickUp tidak memiliki izin untuk tindakan ini".to_string(),
        429 => "Batas permintaan API ClickUp tercapai; coba lagi nanti".to_string(),
        _ => format!("API ClickUp merespons HTTP {}", status.as_u16()),
    })
}

#[tauri::command]
fn get_clickup_config() -> Result<ClickUpConfig, String> {
    let settings = read_app_settings()?;
    Ok(ClickUpConfig {
        api_key_configured: settings.click_up.api_key.trim().starts_with("pk_"),
        list_ids: settings.click_up.list_ids,
        settings_path: app_settings_path()?.display().to_string(),
        task_template: settings.click_up.task_template,
    })
}

#[tauri::command]
fn save_clickup_config(api_key: String, list_ids: String) -> Result<ClickUpConfig, String> {
    let ids = parse_clickup_list_ids(&list_ids)?;
    update_app_settings(|settings| {
        let token = if api_key.trim().is_empty() {
            settings.click_up.api_key.clone()
        } else {
            let token = api_key.trim();
            validate_clickup_api_key(token)?;
            token.to_string()
        };
        if !token.is_empty() {
            validate_clickup_api_key(&token)?;
        }
        settings.click_up = ClickUpSettings {
            api_key: token,
            list_ids: ids,
            task_template: settings.click_up.task_template.clone(),
        };
        Ok(())
    })?;
    get_clickup_config()
}

#[tauri::command]
async fn get_clickup_tasks(
    list_id: String,
    page: u32,
    due_date_gt: Option<i64>,
) -> Result<Vec<ClickUpTask>, String> {
    validate_clickup_list_id(&list_id)?;

    let token = read_clickup_token()?;
    let client = http_client();
    let user = clickup_response(
        client
            .get(format!("{CLICKUP_API_BASE}/user"))
            .header(reqwest::header::AUTHORIZATION, &token),
    )
    .await?
    .json::<ClickUpUserResponse>()
    .await
    .map_err(|_| "Respons identitas dari ClickUp tidak valid".to_string())?
    .user;
    let mut request = client
        .get(format!("{CLICKUP_API_BASE}/list/{list_id}/task"))
        .query(&[
            ("assignees[]", user.id.to_string()),
            ("page", page.to_string()),
            ("archived", "false".to_string()),
            ("include_closed", "true".to_string()),
        ]);
    if let Some(timestamp) = due_date_gt {
        request = request.query(&[("due_date_gt", timestamp)]);
    }
    let response = clickup_response(request.header(reqwest::header::AUTHORIZATION, token)).await?;
    let tasks = response
        .json::<ClickUpTaskListResponse>()
        .await
        .map_err(|_| "Respons daftar task dari ClickUp tidak valid".to_string())?
        .tasks;
    Ok(tasks)
}

#[tauri::command]
async fn create_clickup_tasks(
    list_id: String,
    name: String,
    due_dates: Vec<i64>,
) -> Result<Vec<ClickUpTask>, String> {
    validate_clickup_list_id(&list_id)?;
    let name = name.trim();
    if name.is_empty() || name.len() > 500 {
        return Err("Nama task wajib diisi dan maksimal 500 karakter".to_string());
    }
    if due_dates.is_empty() || due_dates.len() > 262 {
        return Err(
            "Tidak ada tanggal hari kerja yang dipilih atau rentang terlalu panjang".to_string(),
        );
    }
    if due_dates.iter().any(|timestamp| {
        timestamp.rem_euclid(86_400_000) != 0
            || matches!((timestamp.div_euclid(86_400_000) + 4).rem_euclid(7), 0 | 6)
    }) {
        return Err("Daftar due date hanya boleh berisi hari Senin sampai Jumat".to_string());
    }

    let token = read_clickup_token()?;
    let client = http_client();
    let user = clickup_response(
        client
            .get(format!("{CLICKUP_API_BASE}/user"))
            .header(reqwest::header::AUTHORIZATION, &token),
    )
    .await?
    .json::<ClickUpUserResponse>()
    .await
    .map_err(|_| "Respons identitas dari ClickUp tidak valid".to_string())?
    .user;

    let mut created_tasks = Vec::with_capacity(due_dates.len());
    for due_date in &due_dates {
        let response = clickup_response(
            client
                .post(format!("{CLICKUP_API_BASE}/list/{list_id}/task"))
                .header(reqwest::header::AUTHORIZATION, &token)
                .json(&serde_json::json!({
                    "name": name,
                    "start_date": due_date,
                    "due_date": due_date,
                    "status": "COMPLETED",
                    "assignees": [user.id],
                    "custom_fields": [{
                        "id": "6cdad18e-1394-46d1-a2db-5f1274bb5eb0",
                        "value": "e830a1e1-d587-4531-acec-54fb3ef328cf"
                    }],
                    "time_estimate": 28_800_000
                })),
        )
        .await
        .map_err(|error| {
            format!(
                "Gagal membuat task untuk due date {due_date}; {} task berhasil dibuat: {error}",
                created_tasks.len(),
            )
        })?;
        let task = response
            .json::<ClickUpTask>()
            .await
            .map_err(|_| {
                format!(
                    "Task untuk due date {due_date} mungkin sudah dibuat, tetapi respons ClickUp tidak valid. Periksa ClickUp sebelum mencoba ulang."
                )
            })?;

        let time_entry = clickup_response(
            client
                .post(format!("{CLICKUP_API_BASE}/team/3784855/time_entries"))
                .header(reqwest::header::AUTHORIZATION, &token)
                .json(&serde_json::json!({
                    "tid": task.id,
                    "start": due_date.saturating_add(18_000_000),
                    "duration": 28_800_000,
                    "billable": true
                })),
        )
        .await;
        if let Err(error) = time_entry {
            return Err(format!(
                "Task {} berhasil dibuat, tetapi pencatatan time entry gagal. {} task lengkap sebelumnya: {error}",
                task.id,
                created_tasks.len()
            ));
        }

        created_tasks.push(task);
    }

    Ok(created_tasks)
}

#[tauri::command]
fn seek_media(position_seconds: f64) -> Result<(), String> {
    if !position_seconds.is_finite() || position_seconds < 0.0 {
        return Err("Posisi media tidak valid".to_string());
    }

    unsafe {
        let _ = CoInitialize(None);
        let result = (|| {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .map_err(|error| error.to_string())?
                .get()
                .map_err(|error| error.to_string())?;
            let session = manager
                .GetCurrentSession()
                .map_err(|error| error.to_string())?;
            let ticks = (position_seconds * 10_000_000.0).min(i64::MAX as f64) as i64;
            let operation = session
                .TryChangePlaybackPositionAsync(ticks)
                .map_err(|error| error.to_string())?;
            if operation.get().map_err(|error| error.to_string())? {
                Ok(())
            } else {
                Err("Sesi media tidak mendukung seek".to_string())
            }
        })();
        CoUninitialize();
        result
    }
}

#[tauri::command]
fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut encoded: Vec<u16> = text.encode_utf16().take(10_000).collect();
    encoded.push(0);

    unsafe {
        OpenClipboard(None).map_err(|error| error.to_string())?;
        let result = (|| {
            EmptyClipboard().map_err(|error| error.to_string())?;
            let memory = GlobalAlloc(GMEM_MOVEABLE, encoded.len() * std::mem::size_of::<u16>())
                .map_err(|error| error.to_string())?;
            let pointer = GlobalLock(memory) as *mut u16;
            if pointer.is_null() {
                let _ = GlobalFree(memory);
                return Err("Tidak dapat mengalokasikan teks clipboard".to_string());
            }
            std::ptr::copy_nonoverlapping(encoded.as_ptr(), pointer, encoded.len());
            let _ = GlobalUnlock(memory);
            if let Err(error) = SetClipboardData(13, HANDLE(memory.0 as isize)) {
                let _ = GlobalFree(memory);
                return Err(error.to_string());
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[tauri::command]
fn get_display_brightness() -> Result<u8, String> {
    let output = command_no_window("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$monitor = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1; if (-not $monitor) { throw 'No supported display brightness control was found.' }; [int]$monitor.CurrentBrightness",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u8>()
        .map(|value| value.min(100))
        .map_err(|error| format!("Tidak dapat membaca tingkat kecerahan: {error}"))
}

#[tauri::command]
fn set_display_brightness(level: u8) -> Result<(), String> {
    let level = level.min(100);
    let script = format!(
        "$methods = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1; if (-not $methods) {{ throw 'No supported display brightness control was found.' }}; $result = $methods.WmiSetBrightness(1, {level}); if ($result.ReturnValue -ne 0) {{ throw \"Brightness update failed with code $($result.ReturnValue).\" }}"
    );
    let output = command_no_window("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn calculate_island_window_rect(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    width: i32,
    height: i32,
    position: u8,
    edge_offset: i32,
) -> (i32, i32, i32, i32) {
    let clamped_width = width.clamp(1, monitor_width.max(1));
    let clamped_height = height.clamp(1, monitor_height.max(1));
    let max_x_offset = (monitor_width - clamped_width).max(0);
    let max_y_offset = (monitor_height - clamped_height).max(0);
    let safe_x_offset = edge_offset.clamp(0, max_x_offset);
    let safe_y_offset = edge_offset.clamp(0, max_y_offset);
    match position {
        1 => (
            monitor_x + safe_x_offset,
            monitor_y + ((monitor_height - clamped_height).max(0) / 2),
            clamped_width,
            clamped_height,
        ),
        2 => (
            monitor_x + (monitor_width - clamped_width - safe_x_offset).max(0),
            monitor_y + ((monitor_height - clamped_height).max(0) / 2),
            clamped_width,
            clamped_height,
        ),
        _ => (
            monitor_x + ((monitor_width - clamped_width).max(0) / 2),
            monitor_y + safe_y_offset,
            clamped_width,
            clamped_height,
        ),
    }
}

fn configure_borderless_island_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map(|handle| HWND(handle.0 as isize))
        .map_err(|error| error.to_string())?;
    unsafe {
        let current_style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let stripped = current_style
            & !(WS_CAPTION.0
                | WS_THICKFRAME.0
                | WS_MINIMIZEBOX.0
                | WS_MAXIMIZEBOX.0
                | WS_SYSMENU.0);
        let new_style = stripped | WS_POPUP.0;
        SetWindowLongW(hwnd, GWL_STYLE, new_style as i32);
        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorOption {
    index: usize,
    name: String,
    width: u32,
    height: u32,
    is_primary: bool,
}

#[tauri::command]
fn list_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorOption>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Jendela utama Dynamic Island tidak ditemukan".to_string())?;
    let primary_pos = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.position().x, m.position().y));
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let size = monitor.size();
            let pos = monitor.position();
            let is_primary = primary_pos == Some((pos.x, pos.y));
            let label = monitor
                .name()
                .map(|n| n.trim_start_matches(r"\\.\").to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| format!("Monitor {}", index + 1));
            MonitorOption {
                index,
                name: label,
                width: size.width,
                height: size.height,
                is_primary,
            }
        })
        .collect())
}

fn apply_island_window_bounds(
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
    position: u8,
    edge_offset: f64,
    monitor_index: Option<usize>,
) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("Ukuran jendela Dynamic Island tidak valid".to_string());
    }

    let selected_monitor = if let Some(idx) = monitor_index {
        window
            .available_monitors()
            .ok()
            .and_then(|monitors| monitors.into_iter().nth(idx))
    } else {
        None
    };
    let monitor = selected_monitor
        .or(window
            .primary_monitor()
            .map_err(|error| error.to_string())?)
        .or(window
            .current_monitor()
            .map_err(|error| error.to_string())?)
        .ok_or_else(|| "Monitor utama tidak ditemukan".to_string())?;
    let scale_factor = monitor.scale_factor().max(0.1);
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let phys_width = (width * scale_factor).ceil() as i32;
    let phys_height = (height * scale_factor).ceil() as i32;
    let phys_offset = if edge_offset.is_finite() {
        (edge_offset.clamp(0.0, 64.0) * scale_factor).round() as i32
    } else {
        0
    };
    let (x, y, w, h) = calculate_island_window_rect(
        monitor_pos.x,
        monitor_pos.y,
        monitor_size.width as i32,
        monitor_size.height as i32,
        phys_width,
        phys_height,
        position,
        phys_offset,
    );

    let hwnd = window
        .hwnd()
        .map(|handle| HWND(handle.0 as isize))
        .map_err(|error| error.to_string())?;
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            x,
            y,
            w,
            h,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
    }
    .map_err(|error| format!("Gagal memposisikan jendela Dynamic Island: {error}"))?;
    Ok(())
}

#[tauri::command]
fn set_island_window_bounds(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    position: u8,
    edge_offset: Option<f64>,
    monitor_index: Option<usize>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Jendela utama Dynamic Island tidak ditemukan".to_string())?;
    apply_island_window_bounds(
        &window,
        width,
        height,
        position,
        edge_offset.unwrap_or(0.0),
        monitor_index,
    )
}

#[tauri::command]
fn lock_windows() -> Result<(), String> {
    unsafe { LockWorkStation() }.map_err(|error| error.to_string())
}

fn send_keyboard_shortcut(
    modifiers: &[VIRTUAL_KEY],
    key: VIRTUAL_KEY,
    shortcut_name: &str,
) -> Result<(), String> {
    let key_input = |key: VIRTUAL_KEY, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let mut inputs = Vec::with_capacity(modifiers.len() * 2 + 2);
    inputs.extend(
        modifiers
            .iter()
            .copied()
            .map(|modifier| key_input(modifier, Default::default())),
    );
    inputs.push(key_input(key, Default::default()));
    inputs.push(key_input(key, KEYEVENTF_KEYUP));
    inputs.extend(
        modifiers
            .iter()
            .rev()
            .copied()
            .map(|modifier| key_input(modifier, KEYEVENTF_KEYUP)),
    );
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(format!("Windows tidak menerima shortcut {shortcut_name}"))
    }
}

#[tauri::command]
fn open_snipping_tool() -> Result<(), String> {
    {
        let mut pending = PENDING_SNIP_CAPTURE
            .lock()
            .map_err(|error| error.to_string())?;
        *pending = Some((Instant::now() + Duration::from_secs(120), unsafe {
            GetClipboardSequenceNumber()
        }));
    }

    let result = send_keyboard_shortcut(&[VK_LWIN, VK_SHIFT], VK_S, "Win + Shift + S");
    if result.is_err() {
        let mut pending = PENDING_SNIP_CAPTURE
            .lock()
            .map_err(|error| error.to_string())?;
        *pending = None;
    }
    result
}

fn encode_bmp_from_bgra(width: u32, height: u32, pixels: &[u8]) -> Result<Vec<u8>, String> {
    let width_usize = usize::try_from(width).map_err(|error| error.to_string())?;
    let height_usize = usize::try_from(height).map_err(|error| error.to_string())?;
    let expected_pixel_bytes = width_usize
        .checked_mul(height_usize)
        .and_then(|pixel_count| pixel_count.checked_mul(4))
        .ok_or_else(|| "Ukuran screenshot terlalu besar".to_string())?;
    if width == 0 || height == 0 || pixels.len() != expected_pixel_bytes {
        return Err("Data screenshot tidak valid".to_string());
    }

    let row_bytes = width_usize
        .checked_mul(3)
        .ok_or_else(|| "Ukuran screenshot terlalu besar".to_string())?;
    let row_stride = row_bytes
        .checked_add(3)
        .map(|size| size & !3)
        .ok_or_else(|| "Ukuran screenshot terlalu besar".to_string())?;
    let image_bytes = row_stride
        .checked_mul(height_usize)
        .ok_or_else(|| "Ukuran screenshot terlalu besar".to_string())?;
    let file_size = 54usize
        .checked_add(image_bytes)
        .filter(|size| *size <= u32::MAX as usize)
        .ok_or_else(|| "Ukuran screenshot melebihi batas format BMP".to_string())?;
    let signed_height = i32::try_from(height)
        .map_err(|error| error.to_string())?
        .checked_neg()
        .ok_or_else(|| "Tinggi screenshot tidak valid".to_string())?;

    let mut output = Vec::with_capacity(file_size);
    output.extend_from_slice(b"BM");
    output.extend_from_slice(&(file_size as u32).to_le_bytes());
    output.extend_from_slice(&[0; 4]);
    output.extend_from_slice(&54u32.to_le_bytes());
    output.extend_from_slice(&40u32.to_le_bytes());
    output.extend_from_slice(&(width as i32).to_le_bytes());
    output.extend_from_slice(&signed_height.to_le_bytes());
    output.extend_from_slice(&1u16.to_le_bytes());
    output.extend_from_slice(&24u16.to_le_bytes());
    output.extend_from_slice(&0u32.to_le_bytes());
    output.extend_from_slice(&(image_bytes as u32).to_le_bytes());
    output.extend_from_slice(&[0; 16]);

    for row in 0..height_usize {
        let source_row = row * width_usize * 4;
        for column in 0..width_usize {
            let pixel = source_row + column * 4;
            output.extend_from_slice(&pixels[pixel..pixel + 3]);
        }
        while (output.len() - 54) % row_stride != 0 {
            output.push(0);
        }
    }
    Ok(output)
}

fn capture_full_screen_bmp() -> Result<Vec<u8>, String> {
    let (screen_x, screen_y, width, height) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    if width <= 0 || height <= 0 {
        return Err("Ukuran layar tidak valid".to_string());
    }

    let width_usize = usize::try_from(width).map_err(|error| error.to_string())?;
    let height_usize = usize::try_from(height).map_err(|error| error.to_string())?;
    let buffer_size = width_usize
        .checked_mul(height_usize)
        .and_then(|pixel_count| pixel_count.checked_mul(4))
        .ok_or_else(|| "Ukuran layar terlalu besar".to_string())?;
    if buffer_size > u32::MAX as usize {
        return Err("Ukuran layar melebihi batas format screenshot".to_string());
    }

    let screen_dc = unsafe { GetDC(HWND(0)) };
    if screen_dc.is_invalid() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let memory_dc = unsafe { CreateCompatibleDC(screen_dc) };
    if memory_dc.is_invalid() {
        let error = std::io::Error::last_os_error().to_string();
        unsafe {
            ReleaseDC(HWND(0), screen_dc);
        }
        return Err(error);
    }
    let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
    if bitmap.is_invalid() {
        let error = std::io::Error::last_os_error().to_string();
        unsafe {
            DeleteDC(memory_dc);
            ReleaseDC(HWND(0), screen_dc);
        }
        return Err(error);
    }

    let result = unsafe {
        let original = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        if original.is_invalid() {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            let blit = BitBlt(
                memory_dc,
                0,
                0,
                width,
                height,
                screen_dc,
                screen_x,
                screen_y,
                windows::Win32::Graphics::Gdi::ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0),
            );
            let restore = SelectObject(memory_dc, original);
            if restore.is_invalid() {
                Err(std::io::Error::last_os_error().to_string())
            } else if let Err(error) = blit {
                Err(error.to_string())
            } else {
                let mut info = BITMAPINFO::default();
                info.bmiHeader.biSize =
                    std::mem::size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
                info.bmiHeader.biWidth = width;
                info.bmiHeader.biHeight = -height;
                info.bmiHeader.biPlanes = 1;
                info.bmiHeader.biBitCount = 32;
                info.bmiHeader.biCompression = BI_RGB.0;
                info.bmiHeader.biSizeImage = buffer_size as u32;
                let mut pixels = vec![0u8; buffer_size];
                let copied_lines = GetDIBits(
                    screen_dc,
                    bitmap,
                    0,
                    height as u32,
                    Some(pixels.as_mut_ptr() as *mut std::ffi::c_void),
                    &mut info,
                    DIB_RGB_COLORS,
                );
                if copied_lines != height {
                    Err(std::io::Error::last_os_error().to_string())
                } else {
                    encode_bmp_from_bgra(width as u32, height as u32, &pixels)
                }
            }
        }
    };

    let delete_memory_dc = unsafe { DeleteDC(memory_dc) }.as_bool();
    let delete_bitmap = unsafe { DeleteObject(HGDIOBJ(bitmap.0)) }.as_bool();
    let release_screen_dc = unsafe { ReleaseDC(HWND(0), screen_dc) } != 0;
    match result {
        Ok(image) if delete_bitmap && delete_memory_dc && release_screen_dc => Ok(image),
        Ok(_) => Err("Tidak dapat membersihkan sumber screenshot Windows".to_string()),
        Err(error) => Err(error),
    }
}

fn screenshot_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("screenshots");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Tidak dapat membuat folder screenshot: {error}"))?;
    Ok(directory)
}

fn save_capture_file(app: &tauri::AppHandle, kind: &str, bytes: &[u8]) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let directory = screenshot_directory(app)?;
    for suffix in 0..1000 {
        let file_name = if suffix == 0 {
            format!("{kind}-{timestamp}.bmp")
        } else {
            format!("{kind}-{timestamp}-{suffix}.bmp")
        };
        let path = directory.join(file_name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes) {
                    if let Err(cleanup_error) = fs::remove_file(&path) {
                        eprintln!(
                            "Gagal membersihkan file screenshot yang tidak lengkap: {cleanup_error}"
                        );
                    }
                    return Err(format!("Tidak dapat menyimpan screenshot: {error}"));
                }
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(format!("Tidak dapat menyimpan screenshot: {error}"));
            }
        }
    }
    Err("Tidak dapat membuat nama file screenshot yang unik".to_string())
}

fn wrap_dib_as_bmp(dib: &[u8]) -> Result<Vec<u8>, String> {
    if dib.len() < 40 {
        return Err("Data snip pada clipboard tidak valid".to_string());
    }
    let header_size = u32::from_le_bytes(dib[0..4].try_into().unwrap()) as usize;
    let width = i32::from_le_bytes(dib[4..8].try_into().unwrap());
    let height = i32::from_le_bytes(dib[8..12].try_into().unwrap());
    let bit_count = u16::from_le_bytes(dib[14..16].try_into().unwrap());
    let compression = u32::from_le_bytes(dib[16..20].try_into().unwrap());
    let color_count = u32::from_le_bytes(dib[32..36].try_into().unwrap()) as usize;
    if header_size < 40 || header_size > dib.len() || width <= 0 || height == 0 || bit_count == 0 {
        return Err("Format snip pada clipboard tidak didukung".to_string());
    }

    let masks_size = if header_size == 40 {
        match compression {
            3 => 12usize,
            6 => 16usize,
            _ => 0usize,
        }
    } else {
        0
    };
    let palette_entries = if bit_count <= 8 {
        if color_count > 0 {
            color_count
        } else {
            1usize << bit_count
        }
    } else {
        0
    };
    let pixel_offset = header_size
        .checked_add(masks_size)
        .and_then(|offset| offset.checked_add(palette_entries.checked_mul(4)?))
        .filter(|offset| *offset <= dib.len())
        .ok_or_else(|| "Data snip pada clipboard tidak lengkap".to_string())?;
    let file_size = 14usize
        .checked_add(dib.len())
        .filter(|size| *size <= u32::MAX as usize)
        .ok_or_else(|| "Ukuran snip melebihi batas format BMP".to_string())?;
    let pixel_offset = 14usize
        .checked_add(pixel_offset)
        .filter(|offset| *offset <= u32::MAX as usize)
        .ok_or_else(|| "Offset data snip tidak valid".to_string())?;

    let mut output = Vec::with_capacity(file_size);
    output.extend_from_slice(b"BM");
    output.extend_from_slice(&(file_size as u32).to_le_bytes());
    output.extend_from_slice(&[0; 4]);
    output.extend_from_slice(&(pixel_offset as u32).to_le_bytes());
    output.extend_from_slice(dib);
    Ok(output)
}

fn get_clipboard_dib() -> Result<Option<Vec<u8>>, String> {
    unsafe {
        if OpenClipboard(None).is_err() {
            return Ok(None);
        }
        let result = (|| {
            let handle = GetClipboardData(17).or_else(|_| GetClipboardData(8));
            let Ok(handle) = handle else {
                return Ok(None);
            };
            let global = HGLOBAL(handle.0 as *mut std::ffi::c_void);
            let size = GlobalSize(global);
            if !(40..=512 * 1024 * 1024).contains(&size) {
                return Err("Ukuran snip pada clipboard tidak valid".to_string());
            }
            let pointer = GlobalLock(global);
            if pointer.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let dib = std::slice::from_raw_parts(pointer as *const u8, size).to_vec();
            if let Err(error) = GlobalUnlock(global) {
                if error.code().0 != 0 {
                    return Err(error.to_string());
                }
            }
            Ok(Some(dib))
        })();
        let close_result = CloseClipboard();
        if let Err(error) = close_result {
            return Err(error.to_string());
        }
        result
    }
}

fn pending_snip_capture() -> Result<bool, String> {
    let mut pending = PENDING_SNIP_CAPTURE
        .lock()
        .map_err(|error| error.to_string())?;
    if pending.is_some_and(|(expires_at, _)| Instant::now() >= expires_at) {
        *pending = None;
    }
    Ok(pending.is_some())
}

fn snip_clipboard_sequence() -> Result<Option<u32>, String> {
    let pending = PENDING_SNIP_CAPTURE
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(pending.map(|(_, sequence)| sequence))
}

fn clear_pending_snip_capture() -> Result<(), String> {
    *PENDING_SNIP_CAPTURE
        .lock()
        .map_err(|error| error.to_string())? = None;
    Ok(())
}

fn save_pending_snip_capture(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(initial_sequence) = snip_clipboard_sequence()? else {
        return Ok(None);
    };
    if unsafe { GetClipboardSequenceNumber() } == initial_sequence {
        return Ok(None);
    }
    let Some(dib) = get_clipboard_dib()? else {
        return Ok(None);
    };
    let bmp = wrap_dib_as_bmp(&dib)?;
    let path = save_capture_file(app, "snip", &bmp)?;
    clear_pending_snip_capture()?;
    Ok(Some(path))
}

#[derive(serde::Deserialize, serde::Serialize)]
struct AiChatMessage {
    role: String,
    content: String,
}

#[tauri::command]
fn run_screenshot_ocr(app: tauri::AppHandle, image_path: Option<String>) -> Result<String, String> {
    let mut temp_file: Option<PathBuf> = None;
    let target_path = if let Some(path) = image_path.filter(|p| !p.trim().is_empty()) {
        PathBuf::from(path)
    } else {
        let main_window = app.get_webview_window("main");
        let was_visible = main_window
            .as_ref()
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        if was_visible {
            if let Some(window) = main_window.as_ref() {
                let _ = window.hide();
            }
            thread::sleep(Duration::from_millis(120));
        }
        let capture_result = capture_full_screen_bmp();
        if was_visible {
            if let Some(window) = main_window.as_ref() {
                let _ = window.show();
            }
        }
        let bmp_bytes = capture_result?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("di-ocr-{stamp}.bmp"));
        fs::write(&path, &bmp_bytes)
            .map_err(|error| format!("Gagal menyimpan gambar sementara OCR: {error}"))?;
        temp_file = Some(path.clone());
        path
    };

    let escaped_path = target_path.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
}})[0]
function Await-WinRT($op, $resultType) {{
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait()
    return $task.Result
}}
$file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync('{escaped_path}')) ([Windows.Storage.StorageFile])
$stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {{ throw 'Windows OCR engine tidak tersedia untuk bahasa profil saat ini' }}
$result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
Write-Output $result.Text
"#
    );

    let output = command_no_window("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| format!("Gagal menjalankan Windows OCR: {error}"))?;

    if let Some(path) = temp_file {
        let _ = fs::remove_file(path);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Windows OCR gagal memproses gambar".to_string()
        } else {
            stderr
        });
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !text.is_empty() {
        let _ = write_clipboard_text(&text);
    }
    Ok(text)
}

#[tauri::command]
async fn send_ai_chat(
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<AiChatMessage>,
) -> Result<String, String> {
    let url = endpoint.trim();
    if url.is_empty() || (!url.starts_with("http://") && !url.starts_with("https://")) {
        return Err("URL endpoint AI tidak valid".to_string());
    }
    let model_name = model.trim();
    if model_name.is_empty() {
        return Err("Nama model AI wajib diisi".to_string());
    }

    let payload = serde_json::json!({
        "model": model_name,
        "messages": messages,
    });

    let mut request = http_client()
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload);
    let key = api_key.trim();
    if !key.is_empty() {
        request = request.header("Authorization", format!("Bearer {key}"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Gagal menghubungi server AI: {error}"))?;
    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|error| format!("Gagal membaca respons AI: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "AI error ({status}): {}",
            body_text.chars().take(180).collect::<String>()
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|error| format!("Respons JSON AI tidak valid: {error}"))?;

    if let Some(content) = parsed["choices"][0]["message"]["content"].as_str() {
        return Ok(content.trim().to_string());
    }
    if let Some(content) = parsed["message"]["content"].as_str() {
        return Ok(content.trim().to_string());
    }
    if let Some(content) = parsed["response"].as_str() {
        return Ok(content.trim().to_string());
    }

    Err("Format respons AI tidak dikenali".to_string())
}

#[tauri::command]
fn take_screenshot(app: tauri::AppHandle) -> Result<String, String> {
    let main_window = app.get_webview_window("main");
    let was_visible = main_window
        .as_ref()
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if was_visible {
        if let Some(window) = main_window.as_ref() {
            let _ = window.hide();
        }
        thread::sleep(Duration::from_millis(120));
    }

    let capture_result = capture_full_screen_bmp();

    if was_visible {
        if let Some(window) = main_window.as_ref() {
            let _ = window.show();
        }
    }

    let image = capture_result?;
    let path = save_capture_file(&app, "screenshot", &image)?;
    if let Err(error) = app.emit("capture-saved", path.clone()) {
        eprintln!("Gagal memperbarui daftar screenshot: {error}");
    }
    Ok(path)
}

#[tauri::command]
fn list_capture_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let directory = screenshot_directory(&app)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Tidak dapat membaca folder screenshot: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_file()
            && path.extension().and_then(|extension| extension.to_str()) == Some("bmp")
        {
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .map_err(|error| format!("Tidak dapat membaca waktu file screenshot: {error}"))?;
            files.push((modified, path.to_string_lossy().into_owned()));
        }
    }
    files.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(files.into_iter().map(|(_, path)| path).collect())
}

#[tauri::command]
fn delete_capture_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let directory = screenshot_directory(&app)?;
    let canonical_directory = fs::canonicalize(&directory).map_err(|error| error.to_string())?;
    let canonical_file = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    let file_name = canonical_file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nama file screenshot tidak valid".to_string())?;
    if !canonical_file.starts_with(&canonical_directory)
        || canonical_file
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("bmp")
        || !(file_name.starts_with("screenshot-") || file_name.starts_with("snip-"))
    {
        return Err("File yang dipilih bukan hasil screenshot aplikasi".to_string());
    }
    fs::remove_file(canonical_file)
        .map_err(|error| format!("Tidak dapat menghapus screenshot: {error}"))
}

#[tauri::command]
fn control_media(action: &str) -> Result<(), String> {
    unsafe {
        let _ = CoInitialize(None);
        let result = (|| {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .map_err(|error| error.to_string())?
                .get()
                .map_err(|error| error.to_string())?;
            let session = manager
                .GetCurrentSession()
                .map_err(|error| error.to_string())?;
            let operation = match action {
                "playPause" => session.TryTogglePlayPauseAsync(),
                "next" => session.TrySkipNextAsync(),
                "previous" => session.TrySkipPreviousAsync(),
                _ => return Err("Aksi media tidak dikenal".to_string()),
            }
            .map_err(|error| error.to_string())?;

            if operation.get().map_err(|error| error.to_string())? {
                Ok(())
            } else {
                Err("Sesi media tidak menerima perintah ini".to_string())
            }
        })();
        CoUninitialize();
        result
    }
}

#[tauri::command]
fn get_battery_info() -> Result<BatteryInfo, String> {
    let mut status = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut status) }.is_ok() {
        if status.BatteryFlag == 128 {
            return Err("Tidak ada perangkat baterai yang dapat dibaca".to_string());
        }
        if status.BatteryLifePercent <= 100 {
            let percentage = status.BatteryLifePercent as f32;
            let state = match status.ACLineStatus {
                0 => "Discharging",
                1 if percentage >= 100.0 => "Full",
                1 => "Charging",
                _ if status.BatteryFlag & 8 != 0 => "Charging",
                _ => "Unknown",
            };
            return Ok(BatteryInfo {
                percentage: Some(percentage),
                state: state.to_string(),
            });
        }
    }

    let manager = BatteryManager::new().map_err(|error| error.to_string())?;
    let mut batteries = manager.batteries().map_err(|error| error.to_string())?;
    let mut weighted_charge = 0.0_f32;
    let mut total_capacity = 0.0_f32;
    let mut unweighted_charge = 0.0_f32;
    let mut battery_count = 0_u32;
    let mut is_charging = false;
    let mut is_discharging = false;
    let mut all_full = true;

    while let Some(battery_result) = batteries.next() {
        let Ok(battery) = battery_result else {
            continue;
        };
        let charge = battery.state_of_charge().value * 100.0;
        if !charge.is_finite() || !(0.0..=100.0).contains(&charge) {
            continue;
        }

        let capacity = battery.energy_full().value;
        if capacity.is_finite() && capacity > 0.0 {
            weighted_charge += charge * capacity;
            total_capacity += capacity;
        }
        unweighted_charge += charge;
        battery_count += 1;

        match battery.state() {
            battery::State::Charging => is_charging = true,
            battery::State::Discharging => is_discharging = true,
            battery::State::Full => {}
            _ => all_full = false,
        }
    }

    if battery_count == 0 {
        return Err("Tidak ada perangkat baterai yang dapat dibaca".to_string());
    }

    let percentage = if total_capacity > 0.0 {
        weighted_charge / total_capacity
    } else {
        unweighted_charge / battery_count as f32
    };
    let state = if is_charging {
        "Charging"
    } else if is_discharging {
        "Discharging"
    } else if all_full {
        "Full"
    } else {
        "Unknown"
    };

    Ok(BatteryInfo {
        percentage: Some(percentage.clamp(0.0, 100.0)),
        state: state.to_string(),
    })
}

#[tauri::command]
fn get_system_volume() -> Result<f32, String> {
    unsafe {
        let _ = CoInitialize(None);
        let enumerator: IMMDeviceEnumerator =
            windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| e.to_string())?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;
        let volume_control: IAudioEndpointVolume = device
            .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        let level: f32 = volume_control
            .GetMasterVolumeLevelScalar()
            .map_err(|e| e.to_string())?;
        CoUninitialize();
        Ok(level * 100.0)
    }
}

#[tauri::command]
fn set_system_volume(volume: f32) -> Result<(), String> {
    unsafe {
        let _ = CoInitialize(None);
        let enumerator: IMMDeviceEnumerator =
            windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| e.to_string())?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;
        let volume_control: IAudioEndpointVolume = device
            .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        let level = (volume / 100.0).clamp(0.0, 1.0);
        volume_control
            .SetMasterVolumeLevelScalar(level, std::ptr::null())
            .map_err(|e| e.to_string())?;
        CoUninitialize();
        Ok(())
    }
}

fn is_lock_key_on(key: VIRTUAL_KEY) -> bool {
    unsafe { GetKeyState(key.0 as i32) & 1 != 0 }
}

fn is_key_down(key: VIRTUAL_KEY) -> bool {
    unsafe { GetAsyncKeyState(key.0 as i32) & i16::MIN != 0 }
}

fn is_ac_connected() -> Option<bool> {
    unsafe {
        let mut status = SYSTEM_POWER_STATUS::default();
        GetSystemPowerStatus(&mut status).ok()?;
        match status.ACLineStatus {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        }
    }
}

fn emit_system_notice(app_handle: &tauri::AppHandle, title: &str, body: &str) {
    let notice = AutoNotice {
        kind: "system".to_string(),
        title: title.to_string(),
        body: body.to_string(),
        app_name: None,
    };
    let _ = app_handle.emit("system-notification", notice);
}

struct MonitorComState {
    audio_enumerator: Option<IMMDeviceEnumerator>,
    media_manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
}

impl MonitorComState {
    fn new() -> Self {
        unsafe {
            let _ = CoInitialize(None);
        }
        Self {
            audio_enumerator: None,
            media_manager: None,
        }
    }

    fn read_audio_state(&mut self) -> (f32, bool, bool) {
        unsafe {
            if self.audio_enumerator.is_none() {
                self.audio_enumerator = windows::Win32::System::Com::CoCreateInstance(
                    &MMDeviceEnumerator,
                    None,
                    CLSCTX_ALL,
                )
                .ok();
            }
            let Some(enumerator) = self.audio_enumerator.as_ref() else {
                return (0.0, false, false);
            };

            let render_state = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .ok()
                .and_then(|device| {
                    device
                        .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                        .ok()
                })
                .map(|endpoint| {
                    let volume = endpoint
                        .GetMasterVolumeLevelScalar()
                        .ok()
                        .map(|level| (level * 100.0).round())
                        .unwrap_or(0.0);
                    let muted = endpoint
                        .GetMute()
                        .ok()
                        .map(|muted| muted.as_bool())
                        .unwrap_or(false);
                    (volume, muted)
                });

            let mic_muted = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .ok()
                .and_then(|device| {
                    device
                        .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                        .ok()
                })
                .and_then(|endpoint| endpoint.GetMute().ok().map(|muted| muted.as_bool()))
                .unwrap_or(false);

            match render_state {
                Some((volume, output_muted)) => (volume, mic_muted, output_muted),
                None => {
                    self.audio_enumerator = None;
                    (0.0, mic_muted, false)
                }
            }
        }
    }

    fn read_media_info(&mut self) -> Option<MediaInfo> {
        if self.media_manager.is_none() {
            self.media_manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .ok()
                .and_then(|op| op.get().ok());
        }
        let manager = self.media_manager.as_ref()?;
        let session = manager.GetCurrentSession().ok()?;
        let properties = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let playback_status = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?;
        let timeline = session.GetTimelineProperties().ok()?;
        let position_seconds = (timeline.Position().ok()?.Duration as f64 / 10_000_000.0).floor();
        let duration_seconds = (timeline.EndTime().ok()?.Duration as f64 / 10_000_000.0).floor();

        Some(MediaInfo {
            title: properties.Title().ok()?.to_string(),
            artist: properties.Artist().ok()?.to_string(),
            source_app: session.SourceAppUserModelId().ok()?.to_string(),
            is_playing: playback_status
                == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing,
            position_seconds: position_seconds.max(0.0),
            duration_seconds: duration_seconds.max(position_seconds.max(0.0)),
        })
    }
}

impl Drop for MonitorComState {
    fn drop(&mut self) {
        self.audio_enumerator = None;
        self.media_manager = None;
        unsafe {
            CoUninitialize();
        }
    }
}

#[tauri::command]
fn get_current_media_artwork() -> Result<Option<String>, String> {
    unsafe {
        let _ = CoInitialize(None);
        let result = (|| {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .map_err(|error| error.to_string())?
                .get()
                .map_err(|error| error.to_string())?;
            let session = manager
                .GetCurrentSession()
                .map_err(|error| error.to_string())?;
            let properties = session
                .TryGetMediaPropertiesAsync()
                .map_err(|error| error.to_string())?
                .get()
                .map_err(|error| error.to_string())?;
            let Ok(thumbnail) = properties.Thumbnail() else {
                return Ok(None);
            };
            let stream = thumbnail
                .OpenReadAsync()
                .map_err(|error| error.to_string())?
                .get()
                .map_err(|error| error.to_string())?;
            let size = stream.Size().map_err(|error| error.to_string())?;
            if size == 0 || size > 3 * 1024 * 1024 {
                return Ok(None);
            }
            let content_type = stream
                .ContentType()
                .map_err(|error| error.to_string())?
                .to_string();
            if !content_type.starts_with("image/") {
                return Ok(None);
            }
            let input_stream: IInputStream = stream.cast().map_err(|error| error.to_string())?;
            let reader =
                DataReader::CreateDataReader(&input_stream).map_err(|error| error.to_string())?;
            reader
                .LoadAsync(size as u32)
                .map_err(|error| error.to_string())?
                .get()
                .map_err(|error| error.to_string())?;
            let mut bytes = vec![0; size as usize];
            reader
                .ReadBytes(&mut bytes)
                .map_err(|error| error.to_string())?;
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
            Ok(Some(format!("data:{content_type};base64,{encoded}")))
        })();
        CoUninitialize();
        result
    }
}

fn get_windows_notifications_with(
    listener: &UserNotificationListener,
    binding_name: &windows::core::HSTRING,
) -> Result<Vec<WindowsNotification>, String> {
    if listener
        .GetAccessStatus()
        .map_err(|error| error.to_string())?
        != UserNotificationListenerAccessStatus::Allowed
    {
        return Err("Izin notifikasi Windows belum diberikan".to_string());
    }

    let notifications = listener
        .GetNotificationsAsync(NotificationKinds::Toast)
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    let mut result = Vec::new();

    for notification in notifications.into_iter() {
        let text_elements = notification
            .Notification()
            .and_then(|content| content.Visual())
            .and_then(|visual| visual.GetBinding(binding_name))
            .and_then(|binding| binding.GetTextElements())
            .map_err(|error| error.to_string())?;
        let mut text = text_elements
            .into_iter()
            .filter_map(|element| element.Text().ok().map(|value| value.to_string()));
        let app_name = notification
            .AppInfo()
            .and_then(|app| app.DisplayInfo())
            .and_then(|display| display.DisplayName())
            .map(|value| value.to_string())
            .unwrap_or_else(|_| "Windows app".to_string());

        result.push(WindowsNotification {
            id: notification.Id().map_err(|error| error.to_string())?,
            app_name,
            title: text.next().unwrap_or_default(),
            body: text.collect::<Vec<_>>().join(" "),
        });
    }

    result.reverse();
    result.truncate(20);
    Ok(result)
}

#[tauri::command]
fn request_windows_notification_access(app: tauri::AppHandle) -> Result<String, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let operation =
            UserNotificationListener::Current().and_then(|listener| listener.RequestAccessAsync());
        match operation {
            Ok(operation) => {
                thread::spawn(move || {
                    let result = operation
                        .get()
                        .map(|status| {
                            if status == UserNotificationListenerAccessStatus::Allowed {
                                "allowed".to_string()
                            } else {
                                "denied".to_string()
                            }
                        })
                        .map_err(|error| error.to_string());
                    let _ = sender.send(result);
                });
            }
            Err(error) => {
                let _ = sender.send(Err(error.to_string()));
            }
        }
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv_timeout(Duration::from_secs(45))
        .map_err(|error| error.to_string())?
}

fn start_windows_notification_monitor(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        unsafe {
            let _ = CoInitialize(None);
        }
        let Ok(listener) = UserNotificationListener::Current() else {
            unsafe {
                CoUninitialize();
            }
            return;
        };
        let Ok(binding_name) = KnownNotificationBindings::ToastGeneric() else {
            unsafe {
                CoUninitialize();
            }
            return;
        };

        let mut initialized = false;
        let mut seen_ids = HashSet::new();
        let mut seen_order = VecDeque::new();

        loop {
            let sleep_duration = match get_windows_notifications_with(&listener, &binding_name) {
                Ok(notifications) => {
                    if !initialized {
                        for notification in notifications {
                            seen_ids.insert(notification.id);
                            seen_order.push_back(notification.id);
                        }
                        initialized = true;
                    } else {
                        for notification in notifications {
                            if seen_ids.insert(notification.id) {
                                let app_name = notification.app_name.clone();
                                let title = if notification.title.is_empty() {
                                    app_name.clone()
                                } else {
                                    notification.title.clone()
                                };
                                let _ = app_handle.emit(
                                    "system-notification",
                                    AutoNotice {
                                        kind: "notification".to_string(),
                                        title,
                                        body: if notification.body.is_empty() {
                                            app_name.clone()
                                        } else {
                                            notification.body
                                        },
                                        app_name: if app_name.is_empty() {
                                            None
                                        } else {
                                            Some(app_name)
                                        },
                                    },
                                );
                                seen_order.push_back(notification.id);
                            }
                        }

                        while seen_order.len() > 512 {
                            if let Some(expired_id) = seen_order.pop_front() {
                                seen_ids.remove(&expired_id);
                            }
                        }
                    }
                    Duration::from_secs(3)
                }
                Err(_) => Duration::from_secs(15),
            };
            thread::sleep(sleep_duration);
        }
    });
}

#[repr(C)]
struct WlanInterfaceInfo {
    interface_guid: [u32; 4],
    interface_description: [u16; 256],
    is_state: u32,
}

#[repr(C)]
struct WlanInterfaceInfoList {
    number_of_items: u32,
    index: u32,
    interface_info: [WlanInterfaceInfo; 1],
}

#[repr(C)]
struct Dot11Ssid {
    ssid_length: u32,
    ssid: [u8; 32],
}

#[repr(C)]
struct WlanConnectionAttributesPrefix {
    is_state: u32,
    wlan_connection_mode: u32,
    profile_name: [u16; 256],
    dot11_ssid: Dot11Ssid,
}

type WlanOpenHandleFn =
    unsafe extern "system" fn(u32, *mut c_void, *mut u32, *mut *mut c_void) -> u32;
type WlanCloseHandleFn = unsafe extern "system" fn(*mut c_void, *mut c_void) -> u32;
type WlanEnumInterfacesFn =
    unsafe extern "system" fn(*mut c_void, *mut c_void, *mut *mut WlanInterfaceInfoList) -> u32;
type WlanQueryInterfaceFn = unsafe extern "system" fn(
    *mut c_void,
    *const [u32; 4],
    u32,
    *mut c_void,
    *mut u32,
    *mut *mut c_void,
    *mut u32,
) -> u32;
type WlanFreeMemoryFn = unsafe extern "system" fn(*mut c_void);

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryA(lp_lib_file_name: *const i8) -> *mut c_void;
    fn GetProcAddress(h_module: *mut c_void, lp_proc_name: *const i8) -> *mut c_void;
}

struct WlanApi {
    open_handle: WlanOpenHandleFn,
    close_handle: WlanCloseHandleFn,
    enum_interfaces: WlanEnumInterfacesFn,
    query_interface: WlanQueryInterfaceFn,
    free_memory: WlanFreeMemoryFn,
}

unsafe impl Send for WlanApi {}
unsafe impl Sync for WlanApi {}

static WLAN_API: OnceLock<Option<WlanApi>> = OnceLock::new();

fn wlan_api() -> Option<&'static WlanApi> {
    WLAN_API
        .get_or_init(|| unsafe {
            let module = LoadLibraryA(c"wlanapi.dll".as_ptr());
            if module.is_null() {
                return None;
            }
            let open_handle = GetProcAddress(module, c"WlanOpenHandle".as_ptr());
            let close_handle = GetProcAddress(module, c"WlanCloseHandle".as_ptr());
            let enum_interfaces = GetProcAddress(module, c"WlanEnumInterfaces".as_ptr());
            let query_interface = GetProcAddress(module, c"WlanQueryInterface".as_ptr());
            let free_memory = GetProcAddress(module, c"WlanFreeMemory".as_ptr());
            if open_handle.is_null()
                || close_handle.is_null()
                || enum_interfaces.is_null()
                || query_interface.is_null()
                || free_memory.is_null()
            {
                return None;
            }
            Some(WlanApi {
                open_handle: std::mem::transmute::<*mut c_void, WlanOpenHandleFn>(open_handle),
                close_handle: std::mem::transmute::<*mut c_void, WlanCloseHandleFn>(close_handle),
                enum_interfaces: std::mem::transmute::<*mut c_void, WlanEnumInterfacesFn>(
                    enum_interfaces,
                ),
                query_interface: std::mem::transmute::<*mut c_void, WlanQueryInterfaceFn>(
                    query_interface,
                ),
                free_memory: std::mem::transmute::<*mut c_void, WlanFreeMemoryFn>(free_memory),
            })
        })
        .as_ref()
}

fn get_current_ssid() -> String {
    const WLAN_INTERFACE_STATE_CONNECTED: u32 = 1;
    const WLAN_INTF_OPCODE_CURRENT_CONNECTION: u32 = 7;

    let Some(api) = wlan_api() else {
        return String::new();
    };

    unsafe {
        let mut negotiated_version = 0_u32;
        let mut handle: *mut c_void = std::ptr::null_mut();
        if (api.open_handle)(
            2,
            std::ptr::null_mut(),
            &mut negotiated_version,
            &mut handle,
        ) != 0
            || handle.is_null()
        {
            return String::new();
        }

        let ssid = (|| -> String {
            let mut list_ptr: *mut WlanInterfaceInfoList = std::ptr::null_mut();
            if (api.enum_interfaces)(handle, std::ptr::null_mut(), &mut list_ptr) != 0
                || list_ptr.is_null()
            {
                return String::new();
            }

            let count = (*list_ptr).number_of_items as usize;
            let first = (*list_ptr).interface_info.as_ptr();
            let mut found = String::new();

            for index in 0..count {
                let info = &*first.add(index);
                if info.is_state != WLAN_INTERFACE_STATE_CONNECTED {
                    continue;
                }
                let mut data_size = 0_u32;
                let mut data_ptr: *mut c_void = std::ptr::null_mut();
                let mut opcode_value_type = 0_u32;
                let status = (api.query_interface)(
                    handle,
                    &info.interface_guid,
                    WLAN_INTF_OPCODE_CURRENT_CONNECTION,
                    std::ptr::null_mut(),
                    &mut data_size,
                    &mut data_ptr,
                    &mut opcode_value_type,
                );
                if status == 0 && !data_ptr.is_null() {
                    if data_size as usize >= std::mem::size_of::<WlanConnectionAttributesPrefix>() {
                        let attrs = &*(data_ptr as *const WlanConnectionAttributesPrefix);
                        let ssid_len = (attrs.dot11_ssid.ssid_length as usize).min(32);
                        if ssid_len > 0 {
                            found = String::from_utf8_lossy(&attrs.dot11_ssid.ssid[..ssid_len])
                                .trim()
                                .to_string();
                        }
                        if found.is_empty() {
                            let profile_len = attrs
                                .profile_name
                                .iter()
                                .position(|&ch| ch == 0)
                                .unwrap_or(attrs.profile_name.len());
                            found = String::from_utf16_lossy(&attrs.profile_name[..profile_len])
                                .trim()
                                .to_string();
                        }
                    }
                    (api.free_memory)(data_ptr);
                    if !found.is_empty() {
                        break;
                    }
                }
            }

            (api.free_memory)(list_ptr as *mut c_void);
            found
        })();

        let _ = (api.close_handle)(handle, std::ptr::null_mut());
        ssid
    }
}

#[tauri::command]
fn get_network_info() -> NetworkInfo {
    let ssid = get_current_ssid();
    NetworkInfo {
        is_connected: !ssid.is_empty(),
        ssid,
    }
}

#[tauri::command]
fn toggle_wifi(enable: bool) -> Result<(), String> {
    let state = if enable { "enable" } else { "disable" };
    command_no_window("netsh")
        .args([
            "interface",
            "set",
            "interface",
            "name=\"Wi-Fi\"",
            &format!("admin={}", state),
        ])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_power_plan(mode: &str) -> Result<(), String> {
    let guid = match mode {
        "saver" => "a1841308-3541-4fab-bc81-f71556f20b4a",
        "performance" => "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
        _ => "381b4222-f694-41f0-9685-ff5bb260df2e",
    };
    command_no_window("powercfg")
        .args(["/setactive", guid])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn scan_wifi() -> Result<Vec<String>, String> {
    let output = command_no_window("netsh")
        .args(["wlan", "show", "networks"])
        .output()
        .map_err(|e| e.to_string())?;
    let result_str = String::from_utf8_lossy(&output.stdout);
    let mut ssids = Vec::new();
    for line in result_str.lines() {
        if line.contains("SSID") && !line.contains("BSSID") {
            if let Some(ssid) = line.split(':').nth(1) {
                let trimmed = ssid.trim().to_string();
                if !trimmed.is_empty() {
                    ssids.push(trimmed);
                }
            }
        }
    }
    Ok(ssids)
}

#[tauri::command]
fn connect_wifi(ssid: &str) -> Result<(), String> {
    command_no_window("netsh")
        .args(["wlan", "connect", &format!("name={}", ssid)])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn filetime_to_u64(value: FILETIME) -> u64 {
    (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)
}

fn read_cpu_times() -> Result<(u64, u64, u64), String> {
    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user))
            .map_err(|error| error.to_string())?;
    }
    Ok((
        filetime_to_u64(idle),
        filetime_to_u64(kernel),
        filetime_to_u64(user),
    ))
}

fn calculate_cpu_usage(previous: (u64, u64, u64), current: (u64, u64, u64)) -> Option<f32> {
    let idle_delta = current.0.saturating_sub(previous.0);
    let kernel_delta = current.1.saturating_sub(previous.1);
    let user_delta = current.2.saturating_sub(previous.2);
    let total_delta = kernel_delta.saturating_add(user_delta);
    if total_delta == 0 {
        return None;
    }

    let busy_delta = total_delta.saturating_sub(idle_delta);
    Some((busy_delta as f64 / total_delta as f64 * 100.0).clamp(0.0, 100.0) as f32)
}

fn read_memory_usage() -> Result<(u64, u64), String> {
    let mut status = MEMORYSTATUSEX::default();
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut status) }.map_err(|error| error.to_string())?;
    Ok((
        status.ullTotalPhys.saturating_sub(status.ullAvailPhys),
        status.ullTotalPhys,
    ))
}

#[tauri::command]
fn set_auto_hide_fullscreen(enabled: bool) {
    AUTO_HIDE_FULLSCREEN.store(enabled, Ordering::Relaxed);
}

fn is_other_window_fullscreen(own_hwnd: HWND, monitor_rect: Option<(i32, i32, i32, i32)>) -> bool {
    let fg = unsafe { GetForegroundWindow() };
    if fg.0 == 0 || fg == own_hwnd {
        return false;
    }

    let mut class_buf = [0u16; 128];
    let len = unsafe { GetClassNameW(fg, &mut class_buf) };
    if len > 0 {
        let class_name = String::from_utf16_lossy(&class_buf[..len as usize]);
        if matches!(
            class_name.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ) {
            return false;
        }
    }

    let mut rect = RECT::default();
    if unsafe { GetWindowRect(fg, &mut rect) }.is_err() {
        return false;
    }
    let (mon_x, mon_y, mon_w, mon_h) = monitor_rect.unwrap_or_else(|| {
        let w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        let h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        (0, 0, w, h)
    });
    if mon_w <= 0 || mon_h <= 0 {
        return false;
    }
    rect.left <= mon_x
        && rect.top <= mon_y
        && rect.right >= mon_x + mon_w
        && rect.bottom >= mon_y + mon_h
}

fn strip_partial_download_ext(file_name: &str) -> Option<String> {
    const EXTENSIONS: [&str; 5] = [".crdownload", ".part", ".opdownload", ".download", ".tmp"];
    let lower = file_name.to_ascii_lowercase();
    for ext in EXTENSIONS {
        if lower.ends_with(ext) && file_name.len() > ext.len() {
            return Some(file_name[..file_name.len() - ext.len()].to_string());
        }
    }
    None
}

fn scan_active_download() -> Option<ActiveDownloadInfo> {
    let user_profile = std::env::var_os("USERPROFILE")?;
    let downloads_dir = PathBuf::from(user_profile).join("Downloads");
    let entries = fs::read_dir(downloads_dir).ok()?;
    let now = SystemTime::now();
    let mut best: Option<(SystemTime, ActiveDownloadInfo)> = None;

    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        let Some(clean_name) = strip_partial_download_ext(&file_name) else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(age) = now.duration_since(modified) else {
            continue;
        };
        if age > Duration::from_secs(20) {
            continue;
        }
        let info = ActiveDownloadInfo {
            file_name: clean_name,
            size_bytes: metadata.len(),
        };
        if best.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
            best = Some((modified, info));
        }
    }

    best.map(|(_, info)| info)
}

fn parse_bluetooth_battery_output(stdout: &str) -> Option<BluetoothDeviceInfo> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        let Some((name, battery_str)) = trimmed.split_once('|') else {
            continue;
        };
        let clean_name = name.trim();
        let Ok(battery) = battery_str.trim().parse::<u8>() else {
            continue;
        };
        if !clean_name.is_empty() && battery <= 100 {
            return Some(BluetoothDeviceInfo {
                name: clean_name.to_string(),
                battery,
            });
        }
    }
    None
}

fn query_bluetooth_battery() -> Option<BluetoothDeviceInfo> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$devs = Get-PnpDevice -Class Bluetooth -Status OK
foreach ($d in $devs) {
  $prop = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
  if ($prop -and $null -ne $prop.Data) {
    Write-Output "$($d.FriendlyName)|$($prop.Data)"
    break
  }
}
"#;
    let output = command_no_window("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_bluetooth_battery_output(&String::from_utf8_lossy(&output.stdout))
}

fn parse_netstat_bytes(stdout: &str) -> Option<(u64, u64)> {
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let rx = parts[parts.len() - 2].parse::<u64>().ok();
            let tx = parts[parts.len() - 1].parse::<u64>().ok();
            if let (Some(rx), Some(tx)) = (rx, tx) {
                return Some((rx, tx));
            }
        }
    }
    None
}

fn read_network_total_bytes() -> Option<(u64, u64)> {
    let output = command_no_window("netstat").arg("-e").output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_netstat_bytes(&String::from_utf8_lossy(&output.stdout))
}

fn read_pc_idle_seconds() -> u64 {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        let now = unsafe { GetTickCount() };
        let elapsed_ms = now.wrapping_sub(info.dwTime);
        u64::from(elapsed_ms / 1000)
    } else {
        0
    }
}

fn format_capability_app_name(key_path: &str) -> Option<String> {
    let leaf = key_path.rsplit('\\').next()?.trim();
    if leaf.is_empty() || leaf.eq_ignore_ascii_case("NonPackaged") {
        return None;
    }
    let raw = if leaf.contains('#') {
        let exe = leaf.rsplit('#').next().unwrap_or(leaf);
        exe.strip_suffix(".exe")
            .or_else(|| exe.strip_suffix(".EXE"))
            .unwrap_or(exe)
    } else {
        let pkg = leaf.split('_').next().unwrap_or(leaf);
        pkg.strip_prefix("Microsoft.").unwrap_or(pkg)
    };
    let cleaned = raw.trim();
    if cleaned.is_empty() {
        return None;
    }
    let mut chars = cleaned.chars();
    let first = chars.next()?.to_uppercase().to_string();
    Some(format!("{first}{}", chars.as_str()))
}

fn parse_active_capability_app(reg_output: &str) -> Option<String> {
    let mut current_key: Option<&str> = None;
    let mut has_start = false;
    let mut stop_is_zero = false;

    for raw_line in reg_output.lines() {
        let line = raw_line.trim();
        if line.starts_with("HKEY_") {
            if has_start && stop_is_zero {
                if let Some(app) = current_key.and_then(format_capability_app_name) {
                    return Some(app);
                }
            }
            current_key = Some(line);
            has_start = false;
            stop_is_zero = false;
        } else if line.starts_with("LastUsedTimeStart") {
            let value = line.split_whitespace().last().unwrap_or_default();
            has_start = !value.is_empty() && value != "0x0" && value != "0";
        } else if line.starts_with("LastUsedTimeStop") {
            let value = line.split_whitespace().last().unwrap_or_default();
            stop_is_zero = value == "0x0" || value == "0";
        }
    }

    if has_start && stop_is_zero {
        return current_key.and_then(format_capability_app_name);
    }
    None
}

fn query_active_capability_app(capability: &str) -> Option<String> {
    let key = format!(
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{capability}"
    );
    let output = command_no_window("reg")
        .args(["query", &key, "/s"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_active_capability_app(&stdout)
}

fn start_system_monitor(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut com = MonitorComState::new();
        let mut previous_wifi: Option<(bool, String)> = None;
        let mut previous_ac = is_ac_connected();
        let mut low_battery_notified = false;
        let mut full_battery_notified = false;
        let mut previous_cpu_times = None;
        let mut last_battery_error: Option<String> = None;
        let mut last_payload: Option<SysData> = None;
        let mut cached_network = get_network_info();
        let mut cached_camera_app: Option<String> = None;
        let mut cached_mic_app: Option<String> = None;
        let mut cached_download: Option<ActiveDownloadInfo> = None;
        let mut cached_bluetooth: Option<BluetoothDeviceInfo> = None;
        let mut prev_net_bytes: Option<(Instant, u64, u64)> = None;
        let mut cached_net_speed: (Option<u64>, Option<u64>) = (None, None);
        let mut hidden_by_fullscreen = false;
        let mut last_monitor_rect: Option<(i32, i32, i32, i32)> = None;
        let mut tick: u64 = 0;

        loop {
            let cpu_usage = match read_cpu_times() {
                Ok(current) => {
                    let usage = previous_cpu_times
                        .and_then(|previous| calculate_cpu_usage(previous, current))
                        .map(|value| value.round());
                    previous_cpu_times = Some(current);
                    usage
                }
                Err(error) => {
                    eprintln!("Gagal membaca penggunaan CPU: {error}");
                    previous_cpu_times = None;
                    None
                }
            };
            let (memory_used_bytes, memory_total_bytes) = match read_memory_usage() {
                Ok((used, total)) => (Some(used), Some(total)),
                Err(error) => {
                    eprintln!("Gagal membaca penggunaan memori: {error}");
                    (None, None)
                }
            };
            let (battery, battery_error) = match get_battery_info() {
                Ok(battery) => {
                    last_battery_error = None;
                    (battery, None)
                }
                Err(error) => {
                    if last_battery_error.as_deref() != Some(error.as_str()) {
                        eprintln!("Gagal membaca status baterai: {error}");
                        last_battery_error = Some(error.clone());
                    }
                    (
                        BatteryInfo {
                            percentage: None,
                            state: "Unknown".to_string(),
                        },
                        Some(error),
                    )
                }
            };
            let (volume, microphone_muted, output_muted) = com.read_audio_state();
            if tick > 0 && tick % 5 == 0 {
                cached_network = get_network_info();
            }
            let network = &cached_network;
            let current_ac = is_ac_connected();

            if let Some((was_connected, previous_ssid)) = &previous_wifi {
                if *was_connected != network.is_connected {
                    if network.is_connected {
                        emit_system_notice(&app_handle, "Wi-Fi connected", &network.ssid);
                    } else {
                        emit_system_notice(&app_handle, "Wi-Fi disconnected", previous_ssid);
                    }
                } else if network.is_connected && previous_ssid != &network.ssid {
                    emit_system_notice(&app_handle, "Wi-Fi connected", &network.ssid);
                }
            }
            previous_wifi = Some((network.is_connected, network.ssid.clone()));

            if let Some(is_connected_to_ac) = current_ac {
                if let Some(was_connected_to_ac) = previous_ac {
                    if was_connected_to_ac != is_connected_to_ac {
                        if is_connected_to_ac {
                            emit_system_notice(
                                &app_handle,
                                "Power connected",
                                "Battery is charging.",
                            );
                        } else {
                            emit_system_notice(
                                &app_handle,
                                "Power disconnected",
                                "Running on battery.",
                            );
                        }
                    }
                }
                previous_ac = Some(is_connected_to_ac);

                let battery_percentage = battery.percentage.unwrap_or(0.0);
                let has_battery = battery.state != "Unknown" && battery.percentage.is_some();
                let is_low = has_battery && !is_connected_to_ac && battery_percentage <= 20.0;
                let is_full = has_battery && is_connected_to_ac && battery_percentage >= 99.5;

                if is_low && !low_battery_notified {
                    emit_system_notice(
                        &app_handle,
                        "Low battery",
                        &format!("Battery is at {:.0}%.", battery_percentage),
                    );
                    low_battery_notified = true;
                } else if battery_percentage > 23.0 || is_connected_to_ac {
                    low_battery_notified = false;
                }

                if is_full && !full_battery_notified {
                    emit_system_notice(&app_handle, "Battery full", "Battery is fully charged.");
                    full_battery_notified = true;
                } else if battery_percentage < 98.0 || !is_connected_to_ac {
                    full_battery_notified = false;
                }
            }

            if tick % 2 == 0 {
                let current_camera_app = query_active_capability_app("webcam");
                if current_camera_app.is_some() && current_camera_app != cached_camera_app {
                    if let Some(app_name) = current_camera_app.as_deref() {
                        emit_system_notice(
                            &app_handle,
                            "Camera active",
                            &format!("{app_name} is accessing your camera."),
                        );
                    }
                }
                cached_camera_app = current_camera_app;

                let current_mic_app = query_active_capability_app("microphone");
                if current_mic_app.is_some() && current_mic_app != cached_mic_app {
                    if let Some(app_name) = current_mic_app.as_deref() {
                        emit_system_notice(
                            &app_handle,
                            "Microphone active",
                            &format!("{app_name} is accessing your microphone."),
                        );
                    }
                }
                cached_mic_app = current_mic_app;
            }

            if let Some(main_window) = app_handle.get_webview_window("main") {
                if let Ok(raw_hwnd) = main_window.hwnd() {
                    let own_hwnd = HWND(raw_hwnd.0 as isize);
                    if let Ok(Some(monitor)) = main_window.current_monitor() {
                        let pos = monitor.position();
                        let size = monitor.size();
                        last_monitor_rect = Some((pos.x, pos.y, size.width as i32, size.height as i32));
                    }
                    let should_auto_hide = AUTO_HIDE_FULLSCREEN.load(Ordering::Relaxed);
                    let other_fullscreen =
                        should_auto_hide && is_other_window_fullscreen(own_hwnd, last_monitor_rect);
                    if other_fullscreen {
                        if !hidden_by_fullscreen && main_window.is_visible().unwrap_or(false) {
                            let _ = main_window.hide();
                            hidden_by_fullscreen = true;
                        }
                    } else if hidden_by_fullscreen {
                        let _ = main_window.show();
                        hidden_by_fullscreen = false;
                    }
                }
            }

            if tick % 2 == 0 {
                let current_download = scan_active_download();
                if let (Some(prev), None) = (cached_download.as_ref(), current_download.as_ref()) {
                    emit_system_notice(&app_handle, "Download complete", &prev.file_name);
                }
                cached_download = current_download;

                if let Some((rx, tx)) = read_network_total_bytes() {
                    let now = Instant::now();
                    if let Some((prev_time, prev_rx, prev_tx)) = prev_net_bytes {
                        let elapsed = now.duration_since(prev_time).as_secs_f64();
                        if elapsed >= 0.25 {
                            let rx_rate =
                                (rx.saturating_sub(prev_rx) as f64 / elapsed).round() as u64;
                            let tx_rate =
                                (tx.saturating_sub(prev_tx) as f64 / elapsed).round() as u64;
                            cached_net_speed = (Some(rx_rate), Some(tx_rate));
                        }
                    }
                    prev_net_bytes = Some((now, rx, tx));
                }
            }

            if tick % 15 == 0 {
                cached_bluetooth = query_bluetooth_battery();
            }

            let payload = SysData {
                battery: battery.percentage,
                battery_state: battery.state,
                battery_error,
                volume,
                is_wifi_connected: network.is_connected,
                active_wifi_name: network.ssid.clone(),
                caps_lock: is_lock_key_on(VK_CAPITAL),
                num_lock: is_lock_key_on(VK_NUMLOCK),
                scroll_lock: is_lock_key_on(VK_SCROLL),
                microphone_muted,
                output_muted,
                media: com.read_media_info(),
                cpu_usage,
                memory_used_bytes,
                memory_total_bytes,
                camera_active: cached_camera_app.is_some(),
                camera_app: cached_camera_app.clone(),
                mic_in_use: cached_mic_app.is_some(),
                mic_app: cached_mic_app.clone(),
                pc_idle_seconds: read_pc_idle_seconds(),
                active_download: cached_download.clone(),
                bluetooth_device: cached_bluetooth.clone(),
                net_rx_bytes_per_sec: cached_net_speed.0,
                net_tx_bytes_per_sec: cached_net_speed.1,
            };

            if last_payload.as_ref() != Some(&payload) {
                app_handle.emit("system-update", &payload).unwrap_or(());
                last_payload = Some(payload);
            }
            tick = tick.wrapping_add(1);
            thread::sleep(Duration::from_secs(1));
        }
    });
}

fn start_clipboard_activity_monitor(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut last_clipboard_sequence = unsafe { GetClipboardSequenceNumber() };
        let mut previous_copy = false;
        let mut previous_cut = false;
        let mut previous_paste = false;

        loop {
            let clipboard_sequence = unsafe { GetClipboardSequenceNumber() };
            if clipboard_sequence != last_clipboard_sequence {
                last_clipboard_sequence = clipboard_sequence;
                match pending_snip_capture() {
                    Ok(true) => match save_pending_snip_capture(&app_handle) {
                        Ok(Some(path)) => {
                            if let Err(error) = app_handle.emit("capture-saved", path) {
                                eprintln!("Gagal memperbarui daftar snip: {error}");
                            }
                        }
                        Ok(None) => {}
                        Err(error) => {
                            eprintln!("Gagal menyimpan snip: {error}");
                            if let Err(clear_error) = clear_pending_snip_capture() {
                                eprintln!("Gagal membatalkan snip tertunda: {clear_error}");
                            }
                        }
                    },
                    Ok(false) => {}
                    Err(error) => eprintln!("Gagal memeriksa snip tertunda: {error}"),
                }

                let _ = app_handle.emit("clipboard-activity", "clipboard-updated");
                if let Some(text) = get_clipboard_text() {
                    if !text.trim().is_empty() {
                        let _ = app_handle.emit(
                            "clipboard-history-item",
                            ClipboardHistoryItem {
                                text,
                                timestamp: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64,
                            },
                        );
                    }
                }
            }

            let control_down = is_key_down(VK_CONTROL);
            let copy_down = control_down && is_key_down(VK_C);
            let cut_down = control_down && is_key_down(VK_X);
            let paste_down = control_down && is_key_down(VK_V);

            if copy_down && !previous_copy {
                let _ = app_handle.emit("clipboard-activity", "copied");
            } else if cut_down && !previous_cut {
                let _ = app_handle.emit("clipboard-activity", "cut");
            } else if paste_down && !previous_paste {
                let _ = app_handle.emit("clipboard-activity", "pasted");
            }

            previous_copy = copy_down;
            previous_cut = cut_down;
            previous_paste = paste_down;
            thread::sleep(Duration::from_millis(120));
        }
    });
}

fn get_clipboard_text() -> Option<String> {
    unsafe {
        OpenClipboard(None).ok()?;
        let result = (|| {
            let handle = GetClipboardData(13).ok()?;
            let global = HGLOBAL(handle.0 as *mut std::ffi::c_void);
            let pointer = GlobalLock(global);
            if pointer.is_null() {
                return None;
            }

            let units = pointer as *const u16;
            let mut length = 0usize;
            while length < 10_000 && *units.add(length) != 0 {
                length += 1;
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(units, length));
            let _ = GlobalUnlock(global);
            Some(text)
        })();
        let _ = CloseClipboard();
        result
    }
}

fn initialize_app_settings(app: &tauri::AppHandle) -> Result<(), String> {
    let settings_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&settings_dir)
        .map_err(|error| format!("Tidak dapat membuat folder pengaturan aplikasi: {error}"))?;
    let settings_file = settings_dir.join("settings.json");
    let settings_existed = settings_file.is_file();
    APP_SETTINGS_PATH
        .set(settings_file)
        .map_err(|_| "Lokasi settings.json sudah diinisialisasi".to_string())?;

    let legacy_clickup_migrated = read_app_settings()?.legacy_clickup_migrated;
    let legacy_env = if legacy_clickup_migrated {
        None
    } else {
        app.path()
            .resource_dir()
            .ok()
            .map(|directory| directory.join(".env"))
            .filter(|path| path.is_file())
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|executable| executable.parent().map(PathBuf::from))
                    .into_iter()
                    .flat_map(|directory| {
                        directory
                            .ancestors()
                            .take(5)
                            .map(|folder| folder.join(".env"))
                            .collect::<Vec<_>>()
                    })
                    .find(|path| path.is_file())
            })
    };

    let legacy_values = if let Some(path) = legacy_env {
        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("Tidak dapat membaca konfigurasi ClickUp lama: {error}"))?;
        Some(parse_legacy_clickup_settings(&contents)?)
    } else {
        None
    };

    update_app_settings(|settings| {
        if !settings.legacy_clickup_migrated {
            if let Some(values) = legacy_values {
                if settings.click_up.api_key.is_empty() {
                    if let Some(token) = values
                        .get("CLICKUP_API_KEY")
                        .map(|value| value.trim())
                        .filter(|token| !token.is_empty())
                    {
                        if validate_clickup_api_key(token).is_ok() {
                            settings.click_up.api_key = token.to_string();
                        } else {
                            eprintln!(
                                "API key ClickUp lama tidak valid; tidak diimpor ke settings.json."
                            );
                        }
                    }
                }
                if settings.click_up.list_ids.is_empty() {
                    if let Some(raw_ids) = values
                        .get("CLICKUP_LIST_IDS")
                        .filter(|value| !value.trim().is_empty())
                    {
                        match parse_clickup_list_ids(raw_ids) {
                            Ok(list_ids) => {
                                settings.click_up.list_ids = list_ids;
                            }
                            Err(error) => eprintln!("List ID ClickUp lama tidak diimpor: {error}"),
                        }
                    }
                }
            }
            settings.legacy_clickup_migrated = true;
        }
        Ok(())
    })?;

    if !settings_existed {
        eprintln!(
            "Settings baru dibuat di {}.",
            app_settings_path()?.display()
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_cpu_usage, calculate_island_window_rect, encode_bmp_from_bgra,
        parse_active_capability_app, parse_bluetooth_battery_output, parse_legacy_clickup_settings,
        parse_netstat_bytes, strip_partial_download_ext, wrap_dib_as_bmp,
    };

    #[test]
    fn parses_netstat_rx_and_tx_bytes() {
        let sample = "Interface Statistics\n\n                           Received            Sent\n\nBytes                    1590072488       417047830\n";
        assert_eq!(
            parse_netstat_bytes(sample),
            Some((1_590_072_488, 417_047_830))
        );
    }

    #[test]
    fn parses_bluetooth_battery_and_partial_download_names() {
        let bt = parse_bluetooth_battery_output("AirPods Pro|85\n").expect("should parse bt");
        assert_eq!(bt.name, "AirPods Pro");
        assert_eq!(bt.battery, 85);
        assert_eq!(
            strip_partial_download_ext("installer.exe.crdownload").as_deref(),
            Some("installer.exe")
        );
        assert_eq!(strip_partial_download_ext("notes.pdf"), None);
    }

    #[test]
    fn detects_active_webcam_or_mic_app_from_reg_output() {
        let sample = r#"
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam\NonPackaged\C:#Program Files#Google#Chrome#Application#chrome.exe
    LastUsedTimeStart    REG_QWORD    0x1db4f1a2c3d4e500
    LastUsedTimeStop    REG_QWORD    0x0
"#;
        assert_eq!(
            parse_active_capability_app(sample).as_deref(),
            Some("Chrome")
        );
    }

    #[test]
    fn calculates_cpu_usage_from_idle_kernel_and_user_deltas() {
        assert_eq!(
            calculate_cpu_usage((100, 200, 300), (120, 240, 340)),
            Some(75.0)
        );
        assert_eq!(calculate_cpu_usage((100, 200, 300), (100, 200, 300)), None);
    }

    #[test]
    fn calculates_island_window_rect_for_all_positions() {
        assert_eq!(
            calculate_island_window_rect(0, 0, 1920, 1080, 240, 52, 0, 12),
            (840, 12, 240, 52)
        );
        assert_eq!(
            calculate_island_window_rect(0, 0, 1920, 1080, 76, 150, 1, 10),
            (10, 465, 76, 150)
        );
        assert_eq!(
            calculate_island_window_rect(0, 0, 1920, 1080, 76, 150, 2, 10),
            (1834, 465, 76, 150)
        );
    }

    #[test]
    fn encodes_top_down_bgra_pixels_as_padded_bmp_rows() {
        let bmp = encode_bmp_from_bgra(1, 2, &[1, 2, 3, 255, 4, 5, 6, 255])
            .expect("valid pixel data should encode");

        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(i32::from_le_bytes(bmp[22..26].try_into().unwrap()), -2);
        assert_eq!(&bmp[54..62], &[1, 2, 3, 0, 4, 5, 6, 0]);
    }

    #[test]
    fn wraps_clipboard_dib_with_bmp_file_headers() {
        let mut dib = vec![0; 44];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&1i32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&24u16.to_le_bytes());
        dib[40..44].copy_from_slice(&[1, 2, 3, 0]);

        let bmp = wrap_dib_as_bmp(&dib).expect("valid DIB should wrap");

        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 54);
        assert_eq!(u32::from_le_bytes(bmp[2..6].try_into().unwrap()), 58);
        assert_eq!(&bmp[54..], &dib[40..]);
    }

    #[test]
    fn rejects_truncated_clipboard_dib() {
        assert!(wrap_dib_as_bmp(&[0; 16]).is_err());
    }

    #[test]
    fn parses_legacy_clickup_settings_with_utf8_bom() {
        let values = parse_legacy_clickup_settings(
            "\u{feff}CLICKUP_API_KEY=pk_test_token\nCLICKUP_LIST_IDS=123,456\n",
        )
        .expect("valid legacy ClickUp settings should parse");

        assert_eq!(
            values.get("CLICKUP_API_KEY").map(String::as_str),
            Some("pk_test_token")
        );
        assert_eq!(
            values.get("CLICKUP_LIST_IDS").map(String::as_str),
            Some("123,456")
        );
    }

    #[test]
    fn parse_error_does_not_include_env_line_contents() {
        let error = parse_legacy_clickup_settings("INVALID LINE WITH SECRET\n")
            .expect_err("invalid env syntax should fail");

        assert!(!error.contains("SECRET"));
    }

    #[test]
    fn wlan_ffi_struct_offsets_match_win32_abi() {
        use super::{WlanConnectionAttributesPrefix, WlanInterfaceInfo};
        assert_eq!(std::mem::size_of::<WlanInterfaceInfo>(), 532);
        assert_eq!(
            std::mem::offset_of!(WlanConnectionAttributesPrefix, profile_name),
            8
        );
        assert_eq!(
            std::mem::offset_of!(WlanConnectionAttributesPrefix, dot11_ssid),
            520
        );
    }
}

fn enable_windows_startup(executable: &std::path::Path) -> Result<(), String> {
    let command_value = format!("\"{}\"", executable.display());
    let output = command_no_window("reg.exe")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "DynamicIsland",
            "/t",
            "REG_SZ",
            "/d",
            &command_value,
            "/f",
        ])
        .output()
        .map_err(|error| format!("Tidak dapat mengatur startup Windows: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Tidak dapat mengaktifkan startup Windows: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

fn open_settings_from_tray(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("Tidak dapat membuka pengaturan tray: jendela utama tidak ditemukan");
        return;
    };
    if let Err(error) = window.show() {
        eprintln!("Tidak dapat menampilkan jendela dari tray: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("Tidak dapat memfokuskan jendela dari tray: {error}");
    }
    if let Err(error) = app.emit("tray-open-settings", ()) {
        eprintln!("Tidak dapat membuka halaman pengaturan dari tray: {error}");
    }
}

fn toggle_window_from_tray(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("Tidak dapat mengubah visibilitas tray: jendela utama tidak ditemukan");
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            if let Err(error) = window.hide() {
                eprintln!("Tidak dapat menyembunyikan Dynamic Island dari tray: {error}");
            }
        }
        Ok(false) => {
            if let Err(error) = window.show() {
                eprintln!("Tidak dapat menampilkan Dynamic Island dari tray: {error}");
            } else if let Err(error) = window.set_focus() {
                eprintln!("Tidak dapat memfokuskan Dynamic Island dari tray: {error}");
            }
        }
        Err(error) => eprintln!("Tidak dapat membaca visibilitas jendela dari tray: {error}"),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            initialize_app_settings(&app_handle).map_err(std::io::Error::other)?;
            let executable = std::env::current_exe()?;
            enable_windows_startup(&executable).map_err(std::io::Error::other)?;

            // Jalankan thread pemantauan
            start_system_monitor(app_handle.clone());
            start_clipboard_activity_monitor(app_handle.clone());
            start_windows_notification_monitor(app_handle.clone());

            let window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("Jendela utama tidak ditemukan"))?;
            window.set_always_on_top(true)?;
            window.set_resizable(false)?;
            configure_borderless_island_window(&window).map_err(std::io::Error::other)?;
            apply_island_window_bounds(&window, 204.0, 38.0, 0, 0.0, None)
                .map_err(std::io::Error::other)?;

            let icon = app.default_window_icon().cloned().ok_or_else(|| {
                std::io::Error::other("Ikon aplikasi untuk system tray tidak ditemukan")
            })?;
            let settings_item =
                MenuItem::with_id(app, "tray-settings", "Pengaturan", true, None::<&str>)?;
            let visibility_item = MenuItem::with_id(
                app,
                "tray-toggle-visibility",
                "Tampilkan / sembunyikan",
                true,
                None::<&str>,
            )?;
            let exit_item = MenuItem::with_id(app, "tray-exit", "Keluar", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&settings_item, &visibility_item, &exit_item])?;
            let tray_icon = TrayIconBuilder::with_id("dynamic-island-tray")
                .icon(icon)
                .menu(&tray_menu)
                .tooltip("Dynamic Island")
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-settings" => open_settings_from_tray(app),
                    "tray-toggle-visibility" => toggle_window_from_tray(app),
                    "tray-exit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            if !app.manage(tray_icon) {
                return Err(std::io::Error::other("Tidak dapat menyimpan ikon system tray").into());
            }
            window.show()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_battery_info,
            get_system_volume,
            get_network_info,
            control_media,
            seek_media,
            get_current_media_artwork,
            write_clipboard_text,
            get_display_brightness,
            set_display_brightness,
            request_windows_notification_access,
            set_system_volume,
            toggle_wifi,
            set_power_plan,
            scan_wifi,
            connect_wifi,
            set_island_window_bounds,
            list_monitors,
            set_auto_hide_fullscreen,
            lock_windows,
            open_snipping_tool,
            take_screenshot,
            run_screenshot_ocr,
            send_ai_chat,
            list_capture_files,
            delete_capture_file,
            get_clickup_config,
            save_clickup_config,
            load_app_settings,
            migrate_legacy_settings,
            save_app_setting,
            get_clickup_tasks,
            create_clickup_tasks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
