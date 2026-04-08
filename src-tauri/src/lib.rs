use std::process::Command;
use std::path::PathBuf;
use std::fs;

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

/// Install bundled BlackHole driver to ~/Library/Audio/Plug-Ins/HAL/ (no admin needed)
#[tauri::command]
fn install_blackhole(app: tauri::AppHandle) -> Result<String, String> {
    // Destination: user-level HAL plugins directory (no sudo required)
    let dest_base = dirs_next::home_dir()
        .ok_or("Cannot find home directory")?
        .join("Library/Audio/Plug-Ins/HAL");

    let dest = dest_base.join("BlackHole2ch.driver");

    if dest.exists() {
        return Ok("already_installed".to_string());
    }

    // Create destination directory if needed
    fs::create_dir_all(&dest_base).map_err(|e| e.to_string())?;

    // Resolve bundled resource path
    let resource_path = app.path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/BlackHole2ch.driver");

    if !resource_path.exists() {
        return Err(format!("Bundled driver not found at {:?}", resource_path));
    }

    // Copy driver bundle recursively
    copy_dir_all(&resource_path, &dest).map_err(|e| e.to_string())?;

    // Restart CoreAudio so the new driver is picked up immediately
    let _ = Command::new("launchctl")
        .args(["kickstart", "-k", "system/com.apple.audio.coreaudiod"])
        .output();

    Ok("installed".to_string())
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Configure Audio MIDI Setup: create Multi-Output Device (speakers + BlackHole)
/// so system audio flows into BlackHole automatically
#[tauri::command]
fn configure_audio_routing() -> Result<String, String> {
    // Use osascript to open Audio MIDI Setup and guide the user
    // Full auto-config requires CoreAudio C API; for now we open the app
    let script = r#"
        tell application "Audio MIDI Setup" to activate
    "#;
    Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| e.to_string())?;
    Ok("opened".to_string())
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
            install_blackhole,
            configure_audio_routing,
            get_audio_devices,
            get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
