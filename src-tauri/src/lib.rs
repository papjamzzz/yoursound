use std::process::Command;
use std::path::PathBuf;
use std::fs;
use tauri::Manager;

mod audio_routing;

/// Check whether BlackHole is installed
#[tauri::command]
fn check_blackhole() -> bool {
    let output = Command::new("system_profiler")
        .args(["SPAudioDataType", "-json"])
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_lowercase().contains("blackhole"),
        Err(_) => false,
    }
}

/// Install bundled BlackHole driver to ~/Library/Audio/Plug-Ins/HAL/ (no admin needed)
#[tauri::command]
fn install_blackhole(app: tauri::AppHandle) -> Result<String, String> {
    let dest_base = dirs_next::home_dir()
        .ok_or("Cannot find home directory")?
        .join("Library/Audio/Plug-Ins/HAL");
    let dest = dest_base.join("BlackHole2ch.driver");

    if dest.exists() {
        return Ok("already_installed".to_string());
    }

    fs::create_dir_all(&dest_base).map_err(|e| e.to_string())?;

    let resource_path = app.path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/BlackHole2ch.driver");

    if !resource_path.exists() {
        return Err(format!("Bundled driver not found at {:?}", resource_path));
    }

    copy_dir_all(&resource_path, &dest).map_err(|e| e.to_string())?;

    // Restart CoreAudio so driver is picked up immediately
    let _ = Command::new("launchctl")
        .args(["kickstart", "-k", "system/com.apple.audio.coreaudiod"])
        .output();

    Ok("installed".to_string())
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Create a Multi-Output aggregate device (Speakers + BlackHole) and set it
/// as the system default output so system audio flows into BlackHole automatically.
#[tauri::command]
fn setup_audio_routing(app: tauri::AppHandle) -> Result<String, String> {
    audio_routing::setup_multi_output(&app)
}

/// Tear down the YourSound aggregate device and restore original output.
#[tauri::command]
fn restore_audio_routing(app: tauri::AppHandle) -> Result<(), String> {
    audio_routing::restore_original_output(&app)
}

/// Get all audio device names
#[tauri::command]
fn get_audio_devices() -> Vec<String> {
    let output = Command::new("system_profiler")
        .args(["SPAudioDataType", "-json"])
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            let mut names = Vec::new();
            for line in text.lines() {
                if line.trim().starts_with("\"_name\"") {
                    if let Some(name) = line.split(':').nth(1) {
                        let cleaned = name.trim().trim_matches('"').trim_matches(',').to_string();
                        if !cleaned.is_empty() { names.push(cleaned); }
                    }
                }
            }
            names
        }
        Err(_) => vec![],
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let _ = audio_routing::restore_original_output(&window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_blackhole,
            install_blackhole,
            setup_audio_routing,
            restore_audio_routing,
            get_audio_devices,
            get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
