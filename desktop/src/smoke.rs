//! Self-test of the packaged app, for CI on systems without a WebDriver for
//! the system webview (macOS) and as a second check elsewhere.
//!
//! Inactive unless CANVIEWER_SMOKE_FILES is set: then the app clears its
//! stored state, opens each listed file through its own file input (the
//! bytes are handed to the page in an initialization script), saves the
//! first file's message list through the export menu, and calls
//! `smoke_report` with what it showed. The report, with the check of the
//! saved file (smoke/download.rs) added, goes to the file named by
//! CANVIEWER_SMOKE_OUT, and to stdout, and the app exits with 0 if every
//! file opened and the export was saved, 1 if not, or 2 if no report came
//! within five minutes. Without the variable no script is injected, no
//! command is registered and no download is recorded, so the app behaves
//! exactly as it does otherwise.

mod download;

use std::{env, ffi::OsString, fs, path::PathBuf, thread, time::Duration};
use tauri::{webview::DownloadEvent, Manager};

const FILES_VAR: &str = "CANVIEWER_SMOKE_FILES";
const OUT_VAR: &str = "CANVIEWER_SMOKE_OUT";
const TIMEOUT: Duration = Duration::from_secs(300);

/// The files to open, from CANVIEWER_SMOKE_FILES (separated like PATH).
pub fn files_from_env() -> Option<Vec<PathBuf>> {
    env::var_os(FILES_VAR).map(|v: OsString| env::split_paths(&v).collect())
}

pub fn install(builder: tauri::Builder<tauri::Wry>, files: &[PathBuf]) -> tauri::Builder<tauri::Wry> {
    let files: Vec<serde_json::Value> = files
        .iter()
        .map(|path| {
            let bytes = fs::read(path).unwrap_or_else(|e| panic!("{FILES_VAR}: cannot read {}: {e}", path.display()));
            serde_json::json!({
                "name": path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                "data": base64(&bytes),
            })
        })
        .collect();
    let script = include_str!("smoke.js").replace("__FILES__", &serde_json::Value::Array(files).to_string());

    thread::spawn(|| {
        thread::sleep(TIMEOUT);
        eprintln!("smoke: no report after {} s", TIMEOUT.as_secs());
        std::process::exit(2);
    });

    builder
        .plugin(tauri::plugin::Builder::<tauri::Wry, ()>::new("canviewer-smoke").js_init_script(script).build())
        .invoke_handler(tauri::generate_handler![smoke_report, smoke_download_finished])
}

/// Called by the download handler while the self-test runs: keeps what it saw for the report.
pub fn record_download(event: &DownloadEvent<'_>, allowed: bool) {
    download::record(match event {
        DownloadEvent::Requested { url, destination } => {
            download::Seen::Requested { url: url.to_string(), destination: destination.to_path_buf(), allowed }
        }
        DownloadEvent::Finished { url, path, success } => {
            download::Seen::Finished { url: url.to_string(), path: path.clone(), success: *success }
        }
        _ => return,
    });
}

/// Whether the export's download has finished, for smoke.js to wait on.
#[tauri::command]
fn smoke_download_finished() -> bool {
    download::any_finished(&download::seen())
}

#[tauri::command]
fn smoke_report(app: tauri::AppHandle, report: String, passed: bool) {
    let (report, passed) = with_download_check(&app, &report, passed);
    if let Some(out) = env::var_os(OUT_VAR) {
        if let Err(e) = fs::write(&out, &report) {
            eprintln!("smoke: cannot write {}: {e}", PathBuf::from(out).display());
        }
    }
    println!("{report}");
    app.exit(if passed { 0 } else { 1 });
}

/// The report with its `download` entry: the check of the file that smoke.js
/// asked the export menu to save (`export.expected`).
fn with_download_check(app: &tauri::AppHandle, report: &str, passed: bool) -> (String, bool) {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(report) else {
        return (report.to_owned(), false);
    };
    let expected = value["export"]["expected"].as_str().unwrap_or("(no export)").to_owned();
    let download_dir = app.path().download_dir().ok();
    let check = download::check(&download::seen(), &expected, download_dir.as_deref());
    let saved = check["ok"] == true;
    value["download"] = check;
    value["passed"] = (passed && saved).into();
    (serde_json::to_string_pretty(&value).unwrap_or_else(|_| report.to_owned()), passed && saved)
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= chunk.len() { TABLE[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_matches_rfc_4648_vectors() {
        let cases = [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")];
        for (input, expected) in cases {
            assert_eq!(base64(input.as_bytes()), expected);
        }
    }
}
