// Mencegah munculnya jendela console terminal di Windows saat mode rilis
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use battery::Manager as BatteryManager;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

use base64::Engine as _;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::{DataReader, IInputStream};
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND, POINT};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IMMDeviceEnumerator, MMDeviceEnumerator, eCapture, eConsole, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, CoInitialize, CoUninitialize};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    SetClipboardData,
};
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    SendInput, VIRTUAL_KEY, VK_C, VK_CAPITAL, VK_CONTROL, VK_LWIN, VK_NUMLOCK, VK_S, VK_SCROLL,
    VK_SHIFT, VK_V, VK_X,
};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, FindWindowW, GWL_STYLE, GetCursorPos, GetWindowLongW, SW_HIDE, SW_SHOW,
    SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowLongW, SetWindowPos,
    ShowWindow, WINDOW_STYLE, WS_CAPTION, WS_THICKFRAME,
};
use windows::core::{ComInterface, w};
mod models;
use models::*;

static APP_SETTINGS_PATH: OnceLock<PathBuf> = OnceLock::new();
static APP_SETTINGS_LOCK: Mutex<()> = Mutex::new(());
static ISLAND_BOUNDS: OnceLock<Mutex<IslandBounds>> = OnceLock::new();

const CLICKUP_API_BASE: &str = "https://api.clickup.com/api/v2";

fn app_settings_path() -> Result<&'static PathBuf, String> {
    APP_SETTINGS_PATH
        .get()
        .ok_or_else(|| "Lokasi settings.json belum diinisialisasi".to_string())
}

fn read_settings_unlocked() -> Result<AppSettings, String> {
    let path = app_settings_path()?;
    if !path.is_file() {
        return Ok(AppSettings::default());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Tidak dapat membaca settings.json: {error}"))?;
    let mut settings: AppSettings = serde_json::from_str(&contents)
        .map_err(|error| format!("Format settings.json tidak valid: {error}"))?;
    for (key, value) in AppSettings::default().preferences {
        settings.preferences.entry(key).or_insert(value);
    }
    Ok(settings)
}

fn write_settings_unlocked(settings: &AppSettings) -> Result<(), String> {
    let path = app_settings_path()?;
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Tidak dapat menyusun settings.json: {error}"))?;
    fs::write(path, contents)
        .map_err(|error| format!("Tidak dapat menyimpan settings.json: {error}"))
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
    update_app_settings(|settings| {
        settings.preferences.insert(key, value);
        Ok(())
    })
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
    let client = reqwest::Client::new();
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
    let client = reqwest::Client::new();
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
    let output = Command::new("powershell")
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
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
fn update_island_bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width < 0.0
        || height < 0.0
    {
        return Err("Batas Dynamic Island tidak valid".to_string());
    }

    let bounds = ISLAND_BOUNDS.get_or_init(|| Mutex::new(IslandBounds::default()));
    *bounds
        .lock()
        .map_err(|error| format!("Tidak dapat memperbarui batas Dynamic Island: {error}"))? =
        IslandBounds {
            x,
            y,
            width,
            height,
        };
    Ok(())
}

#[tauri::command]
fn set_island_position(app: tauri::AppHandle, position: IslandPosition) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(true);
    }

    // Notify renderer to update the shell position
    let _ = app.emit_to("main", "island-position-changed", position);

    Ok(())
}

#[tauri::command]
fn lock_windows() -> Result<(), String> {
    unsafe { LockWorkStation() }.map_err(|error| error.to_string())
}

#[tauri::command]
fn open_snipping_tool() -> Result<(), String> {
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
    let inputs = [
        key_input(VK_LWIN, Default::default()),
        key_input(VK_SHIFT, Default::default()),
        key_input(VK_S, Default::default()),
        key_input(VK_S, KEYEVENTF_KEYUP),
        key_input(VK_SHIFT, KEYEVENTF_KEYUP),
        key_input(VK_LWIN, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("Windows tidak menerima shortcut Win + Shift + S".to_string())
    }
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
    let battery_reading = (|| {
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
    })();

    let battery_error = match battery_reading {
        Ok(info) => return Ok(info),
        Err(error) => error,
    };

    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe {
        if let Err(error) = GetSystemPowerStatus(&mut status) {
            return Err(format!("{battery_error}; {}", error));
        }
    }
    if status.BatteryFlag == 128 || status.BatteryLifePercent == 255 {
        return Err(battery_error);
    }

    let percentage = status.BatteryLifePercent as f32;
    let state = match status.ACLineStatus {
        0 => "Discharging",
        1 if percentage >= 100.0 => "Full",
        1 => "Charging",
        _ if status.BatteryFlag & 8 != 0 => "Charging",
        _ => "Unknown",
    };
    Ok(BatteryInfo {
        percentage: Some(percentage),
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
    };
    let _ = app_handle.emit("system-notification", notice);
}

fn get_audio_mute_state() -> (bool, bool) {
    unsafe {
        let _ = CoInitialize(None);
        let result = (|| {
            let enumerator: IMMDeviceEnumerator = windows::Win32::System::Com::CoCreateInstance(
                &MMDeviceEnumerator,
                None,
                CLSCTX_ALL,
            )
            .ok()?;

            let read_mute = |flow| {
                let device = enumerator.GetDefaultAudioEndpoint(flow, eConsole).ok()?;
                let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
                endpoint.GetMute().ok().map(|muted| muted.as_bool())
            };

            Some((
                read_mute(eCapture).unwrap_or(false),
                read_mute(eRender).unwrap_or(false),
            ))
        })();
        CoUninitialize();
        result.unwrap_or((false, false))
    }
}

fn get_current_media_info() -> Option<MediaInfo> {
    unsafe {
        let _ = CoInitialize(None);
        let result = (|| {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .ok()?
                .get()
                .ok()?;
            let session = manager.GetCurrentSession().ok()?;
            let properties = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
            let playback_status = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?;
            let timeline = session.GetTimelineProperties().ok()?;
            let position_seconds = timeline.Position().ok()?.Duration as f64 / 10_000_000.0;
            let duration_seconds = timeline.EndTime().ok()?.Duration as f64 / 10_000_000.0;

            Some(MediaInfo {
                title: properties.Title().ok()?.to_string(),
                artist: properties.Artist().ok()?.to_string(),
                source_app: session.SourceAppUserModelId().ok()?.to_string(),
                is_playing: playback_status
                    == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing,
                position_seconds: position_seconds.max(0.0),
                duration_seconds: duration_seconds.max(position_seconds),
            })
        })();
        CoUninitialize();
        result
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

fn get_windows_notifications() -> Result<Vec<WindowsNotification>, String> {
    let listener = UserNotificationListener::Current().map_err(|error| error.to_string())?;
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
    let binding_name =
        KnownNotificationBindings::ToastGeneric().map_err(|error| error.to_string())?;
    let mut result = Vec::new();

    for notification in notifications.into_iter() {
        let text_elements = notification
            .Notification()
            .and_then(|content| content.Visual())
            .and_then(|visual| visual.GetBinding(&binding_name))
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
        let mut initialized = false;
        let mut seen_ids = HashSet::new();
        let mut seen_order = VecDeque::new();

        loop {
            if let Ok(notifications) = get_windows_notifications() {
                if !initialized {
                    for notification in notifications {
                        seen_ids.insert(notification.id);
                        seen_order.push_back(notification.id);
                    }
                    initialized = true;
                } else {
                    for notification in notifications {
                        if seen_ids.insert(notification.id) {
                            let title = if notification.title.is_empty() {
                                notification.app_name.clone()
                            } else {
                                notification.title.clone()
                            };
                            let _ = app_handle.emit(
                                "system-notification",
                                AutoNotice {
                                    kind: "notification".to_string(),
                                    title,
                                    body: if notification.body.is_empty() {
                                        notification.app_name
                                    } else {
                                        notification.body
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
            }
            thread::sleep(Duration::from_secs(2));
        }
    });
}

fn get_current_ssid() -> String {
    if let Ok(output) = Command::new("netsh")
        .args(["wlan", "show", "interfaces"])
        .output()
    {
        let out_str = String::from_utf8_lossy(&output.stdout);
        for line in out_str.lines() {
            if line.trim().starts_with("Profile")
                || (line.trim().starts_with("SSID") && !line.trim().starts_with("BSSID"))
            {
                if let Some(ssid) = line.split(':').nth(1) {
                    return ssid.trim().to_string();
                }
            }
        }
    }
    "".to_string()
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
fn toggle_windows_tray(show: bool) -> Result<(), String> {
    unsafe {
        let taskbar = FindWindowW(w!("Shell_TrayWnd"), None);
        if taskbar.0 != 0 {
            let tray = FindWindowExW(taskbar, None, w!("TrayNotifyWnd"), None);
            if tray.0 != 0 {
                let cmd_show = if show { SW_SHOW } else { SW_HIDE };
                ShowWindow(tray, cmd_show);
                return Ok(());
            }
        }
        Err("System Tray tidak ditemukan".to_string())
    }
}

#[tauri::command]
fn toggle_wifi(enable: bool) -> Result<(), String> {
    let state = if enable { "enable" } else { "disable" };
    Command::new("netsh")
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
    Command::new("powercfg")
        .args(["/setactive", guid])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn scan_wifi() -> Result<Vec<String>, String> {
    let output = Command::new("netsh")
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
    Command::new("netsh")
        .args(["wlan", "connect", &format!("name={}", ssid)])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn start_system_monitor(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut previous_wifi: Option<(bool, String)> = None;
        let mut previous_ac = is_ac_connected();
        let mut low_battery_notified = false;
        let mut full_battery_notified = false;
        loop {
            let (battery, battery_error) = match get_battery_info() {
                Ok(battery) => (battery, None),
                Err(error) => {
                    eprintln!("Gagal membaca status baterai: {error}");
                    (
                        BatteryInfo {
                            percentage: None,
                            state: "Unknown".to_string(),
                        },
                        Some(error),
                    )
                }
            };
            let volume = get_system_volume().unwrap_or(0.0);
            let network = get_network_info();
            let (microphone_muted, output_muted) = get_audio_mute_state();
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

            let payload = SysData {
                battery: battery.percentage,
                battery_state: battery.state,
                battery_error,
                volume,
                is_wifi_connected: network.is_connected,
                active_wifi_name: network.ssid,
                caps_lock: is_lock_key_on(VK_CAPITAL),
                num_lock: is_lock_key_on(VK_NUMLOCK),
                scroll_lock: is_lock_key_on(VK_SCROLL),
                microphone_muted,
                output_muted,
                media: get_current_media_info(),
            };

            app_handle.emit("system-update", payload).unwrap_or(());
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
        let mut previous_brightness_up = false;
        let mut previous_brightness_down = false;

        loop {
            let clipboard_sequence = unsafe { GetClipboardSequenceNumber() };
            if clipboard_sequence != last_clipboard_sequence {
                last_clipboard_sequence = clipboard_sequence;
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
            let brightness_up = is_key_down(VIRTUAL_KEY(0xAE));
            let brightness_down = is_key_down(VIRTUAL_KEY(0xAF));

            if copy_down && !previous_copy {
                let _ = app_handle.emit("clipboard-activity", "copied");
            } else if cut_down && !previous_cut {
                let _ = app_handle.emit("clipboard-activity", "cut");
            } else if paste_down && !previous_paste {
                let _ = app_handle.emit("clipboard-activity", "pasted");
            }
            if brightness_up && !previous_brightness_up {
                emit_system_notice(&app_handle, "Brightness up", "Brightness key pressed.");
            } else if brightness_down && !previous_brightness_down {
                emit_system_notice(&app_handle, "Brightness down", "Brightness key pressed.");
            }

            previous_copy = copy_down;
            previous_cut = cut_down;
            previous_paste = paste_down;
            previous_brightness_up = brightness_up;
            previous_brightness_down = brightness_down;
            thread::sleep(Duration::from_millis(40));
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

fn start_mouse_tracker(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let mut last_in_island: Option<bool> = None;

        loop {
            unsafe {
                let mut pos = POINT { x: 0, y: 0 };
                if GetCursorPos(&mut pos).is_ok() {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let bounds = ISLAND_BOUNDS
                            .get_or_init(|| Mutex::new(IslandBounds::default()))
                            .lock()
                            .map(|bounds| *bounds)
                            .unwrap_or_default();
                        let in_island = if bounds.width > 0.0 && bounds.height > 0.0 {
                            match (window.outer_position(), window.scale_factor()) {
                                (Ok(origin), Ok(scale)) => {
                                    let x = origin.x as f64 + bounds.x * scale;
                                    let y = origin.y as f64 + bounds.y * scale;
                                    let cursor_x = pos.x as f64;
                                    let cursor_y = pos.y as f64;
                                    cursor_x >= x
                                        && cursor_x < x + bounds.width * scale
                                        && cursor_y >= y
                                        && cursor_y < y + bounds.height * scale
                                }
                                _ => false,
                            }
                        } else {
                            false
                        };

                        if last_in_island != Some(in_island) {
                            match window.set_ignore_cursor_events(!in_island) {
                                Ok(()) => last_in_island = Some(in_island),
                                Err(error) => {
                                    eprintln!(
                                        "Gagal mengatur click-through Dynamic Island: {error}"
                                    )
                                }
                            }
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
}

fn remove_native_window_frame(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = HWND(hwnd.0 as isize);

    unsafe {
        let style = WINDOW_STYLE(GetWindowLongW(hwnd, GWL_STYLE) as u32);
        let style = style & !(WS_CAPTION | WS_THICKFRAME);
        SetWindowLongW(hwnd, GWL_STYLE, style.0 as i32);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
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
    use super::parse_legacy_clickup_settings;

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
}

fn enable_windows_startup(executable: &std::path::Path) -> Result<(), String> {
    let command_value = format!("\"{}\" --background", executable.display());
    let output = Command::new("reg.exe")
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

fn create_system_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Buka Dynamic Island", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Dynamic Island")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    app.manage(tray);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            initialize_app_settings(&app_handle).map_err(std::io::Error::other)?;
            let executable = std::env::current_exe()?;
            enable_windows_startup(&executable).map_err(std::io::Error::other)?;
            create_system_tray(app)?;

            // Jalankan thread pemantauan
            start_system_monitor(app_handle.clone());
            start_clipboard_activity_monitor(app_handle.clone());
            start_windows_notification_monitor(app_handle.clone());

            // Sembunyikan taskbar bawaan Windows (opsional)
            let _ = toggle_windows_tray(false);

            // Atur window untuk mode fullscreen + always on top
            let window = app.get_webview_window("main").unwrap();
            window.set_always_on_top(true).unwrap();
            window.set_ignore_cursor_events(true).unwrap();

            window.set_decorations(false).unwrap();
            remove_native_window_frame(&window).map_err(std::io::Error::other)?;
            window.set_resizable(false).unwrap();
            start_mouse_tracker(app_handle.clone());

            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                    return;
                }
                if let tauri::WindowEvent::Focused(_) = event {
                    let _ = window_clone.set_decorations(false);
                    if let Err(error) = remove_native_window_frame(&window_clone) {
                        eprintln!("Gagal menghilangkan frame jendela Dynamic Island: {error}");
                    }
                }
            });
            if std::env::args_os().any(|argument| argument == "--background") {
                window.hide()?;
            }

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
            toggle_windows_tray,
            toggle_wifi,
            set_power_plan,
            scan_wifi,
            connect_wifi,
            update_island_bounds,
            set_island_position,
            lock_windows,
            open_snipping_tool,
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
