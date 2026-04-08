use std::process::Command;

/// Check whether BlackHole is installed (appears as an audio device via system_profiler)
#[tauri::command]
fn check_blackhole() -> bool {
    let output = Command::new("system_profiler")
        .args(["SPAudioDataType", "-json"])
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            text.to_lowercase().contains("blackhole")
        }
        Err(_) => false,
    }
}

/// Get all audio device names from system_profiler
#[tauri::command]
fn get_audio_devices() -> Vec<String> {
    let output = Command::new("system_profiler")
        .args(["SPAudioDataType", "-json"])
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            // Simple parse: extract "_name" values
            let mut names = Vec::new();
            for line in text.lines() {
                if line.trim().starts_with("\"_name\"") {
                    if let Some(name) = line.split(':').nth(1) {
                        let cleaned = name.trim().trim_matches('"').trim_matches(',').to_string();
                        if !cleaned.is_empty() {
                            names.push(cleaned);
                        }
                    }
                }
            }
            names
        }
        Err(_) => vec![],
    }
}

/// Open a native save file dialog and return the chosen path
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_blackhole,
            get_audio_devices,
            get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
