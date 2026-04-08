// ─── Audio Routing via bundled Swift binary ───────────────────────────────────
// The yoursound_routing binary is compiled from setup_routing.swift and bundled
// in the app resources. It creates a Multi-Output aggregate device
// (user's speakers + BlackHole 2ch) and sets it as the system default output.

use std::process::Command;
use tauri::Manager;

fn routing_binary(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|e| e.to_string())
        .map(|d| d.join("yoursound_routing"))
}

pub fn setup_multi_output(app: &tauri::AppHandle) -> Result<String, String> {
    let bin = routing_binary(app)?;
    if !bin.exists() {
        return Err(format!("Routing binary not found at {:?}", bin));
    }
    let out = Command::new(&bin)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("{} {}", stdout, stderr));
    }
    Ok(stdout)
}

pub fn restore_original_output(app: &tauri::AppHandle) -> Result<(), String> {
    let bin = routing_binary(app)?;
    if !bin.exists() { return Ok(()); }
    Command::new(&bin)
        .arg("restore")
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}
