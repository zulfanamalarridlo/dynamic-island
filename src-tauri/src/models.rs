use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Clone)]
pub(crate) struct BatteryInfo {
    pub(crate) percentage: Option<f32>,
    pub(crate) state: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub(crate) struct ClickUpUser {
    pub(crate) id: i64,
    pub(crate) username: String,
    pub(crate) email: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ClickUpUserResponse {
    pub(crate) user: ClickUpUser,
}

#[derive(Serialize)]
pub(crate) struct ClickUpConfig {
    pub(crate) api_key_configured: bool,
    pub(crate) list_ids: Vec<String>,
    pub(crate) settings_path: String,
    pub(crate) task_template: ClickUpTaskTemplate,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ClickUpCustomField {
    pub(crate) id: String,
    pub(crate) value: String,
}

impl Default for ClickUpCustomField {
    fn default() -> Self {
        Self {
            id: String::new(),
            value: String::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ClickUpTaskTemplate {
    pub(crate) team_id: String,
    pub(crate) status: String,
    pub(crate) hours_per_day: f32,
    pub(crate) time_entry_start_minutes_utc: i64,
    pub(crate) billable: bool,
    pub(crate) log_time_entry: bool,
    pub(crate) custom_fields: Vec<ClickUpCustomField>,
}

impl Default for ClickUpTaskTemplate {
    fn default() -> Self {
        Self {
            team_id: String::new(),
            status: "COMPLETED".to_string(),
            hours_per_day: 8.0,
            time_entry_start_minutes_utc: 300, // 05:00 UTC = 18_000_000 ms
            billable: true,
            log_time_entry: true,
            custom_fields: Vec::new(),
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ClickUpSettings {
    pub(crate) api_key: String,
    pub(crate) list_ids: Vec<String>,
    pub(crate) task_template: ClickUpTaskTemplate,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    #[serde(default)]
    pub(crate) preferences: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub(crate) click_up: ClickUpSettings,
    #[serde(default)]
    pub(crate) legacy_preferences_migrated: bool,
    #[serde(default)]
    pub(crate) legacy_clickup_migrated: bool,
    #[serde(default)]
    pub(crate) clickup_template_migrated: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        let mut preferences = HashMap::new();
        preferences.insert("di-language".to_string(), serde_json::json!("id"));
        preferences.insert("di-island-position".to_string(), serde_json::json!(0));
        preferences.insert("di-clipboard-history".to_string(), serde_json::json!([]));
        preferences.insert("di-file-shelf".to_string(), serde_json::json!([]));
        preferences.insert(
            "di-windows-activity-modules".to_string(),
            serde_json::json!({
                "capsLock": true,
                "numLock": true,
                "scrollLock": true,
                "microphone": true,
                "speaker": true,
                "volume": true,
                "clipboard": true,
                "brightness": true,
                "wifi": true,
                "power": true,
                "battery": true
            }),
        );
        preferences.insert(
            "di-windows-notification-notices".to_string(),
            serde_json::json!(true),
        );
        preferences.insert("di-launch-at-startup".to_string(), serde_json::json!(true));
        preferences.insert("di-focus-remaining".to_string(), serde_json::json!(1500));
        preferences.insert("di-focus-minutes".to_string(), serde_json::json!(25));
        preferences.insert("di-break-minutes".to_string(), serde_json::json!(5));
        preferences.insert("di-focus-sessions".to_string(), serde_json::json!(0));
        preferences.insert("di-prayer-reminders".to_string(), serde_json::json!(false));
        preferences.insert("di-clickup-list-id".to_string(), serde_json::json!(""));
        preferences.insert("di-last-prayer-notice".to_string(), serde_json::json!(""));
        Self {
            preferences,
            click_up: ClickUpSettings::default(),
            legacy_preferences_migrated: false,
            legacy_clickup_migrated: false,
            clickup_template_migrated: false,
        }
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub(crate) struct ClickUpTaskStatus {
    pub(crate) status: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub(crate) struct ClickUpTask {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) status: Option<ClickUpTaskStatus>,
    pub(crate) due_date: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ClickUpTaskListResponse {
    pub(crate) tasks: Vec<ClickUpTask>,
}

#[derive(Serialize, Clone)]
pub(crate) struct NetworkInfo {
    pub(crate) is_connected: bool,
    pub(crate) ssid: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardHistoryItem {
    pub(crate) text: String,
    pub(crate) timestamp: u64,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveDownloadInfo {
    pub(crate) file_name: String,
    pub(crate) size_bytes: u64,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BluetoothDeviceInfo {
    pub(crate) name: String,
    pub(crate) battery: u8,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SysData {
    pub(crate) battery: Option<f32>,
    pub(crate) battery_state: String,
    pub(crate) battery_error: Option<String>,
    pub(crate) volume: f32,
    pub(crate) is_wifi_connected: bool,
    pub(crate) active_wifi_name: String,
    pub(crate) caps_lock: bool,
    pub(crate) num_lock: bool,
    pub(crate) scroll_lock: bool,
    pub(crate) microphone_muted: bool,
    pub(crate) output_muted: bool,
    pub(crate) media: Option<MediaInfo>,
    pub(crate) cpu_usage: Option<f32>,
    pub(crate) memory_used_bytes: Option<u64>,
    pub(crate) memory_total_bytes: Option<u64>,
    pub(crate) camera_active: bool,
    pub(crate) camera_app: Option<String>,
    pub(crate) mic_in_use: bool,
    pub(crate) mic_app: Option<String>,
    pub(crate) pc_idle_seconds: u64,
    pub(crate) active_download: Option<ActiveDownloadInfo>,
    pub(crate) bluetooth_device: Option<BluetoothDeviceInfo>,
    pub(crate) net_rx_bytes_per_sec: Option<u64>,
    pub(crate) net_tx_bytes_per_sec: Option<u64>,
}

#[derive(Serialize, Clone, PartialEq)]
pub(crate) struct MediaInfo {
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) source_app: String,
    pub(crate) is_playing: bool,
    pub(crate) position_seconds: f64,
    pub(crate) duration_seconds: f64,
}

#[derive(Serialize, Clone)]
pub(crate) struct WindowsNotification {
    pub(crate) id: u32,
    pub(crate) app_name: String,
    pub(crate) title: String,
    pub(crate) body: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoNotice {
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) app_name: Option<String>,
}
