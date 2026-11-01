// SPDX-License-Identifier: GPL-2.0-or-later
//! Self-test of the packaged app, for CI on systems without a WebDriver for
//! the system webview (macOS) and as a second check elsewhere.
//!
//! Inactive unless CANVIEWER_SMOKE_FILES is set: then the app clears its
//! stored state, opens each listed file through its own file input (the
//! bytes are handed to the page in an initialization script), and calls
//! `smoke_report` with what it showed. The report goes to the file named by
//! CANVIEWER_SMOKE_OUT, and to stdout, and the app exits with 0 if every
//! file opened, 1 if one did not, or 2 if no report came within five
//! minutes. Without the variable no script is injected and no command is
//! registered, so the app behaves exactly as it does otherwise.

use std::{env, ffi::OsString, fs, path::PathBuf, thread, time::Duration};

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
        .invoke_handler(tauri::generate_handler![smoke_report])
}

#[tauri::command]
fn smoke_report(app: tauri::AppHandle, report: String, passed: bool) {
    if let Some(out) = env::var_os(OUT_VAR) {
        if let Err(e) = fs::write(&out, &report) {
            eprintln!("smoke: cannot write {}: {e}", PathBuf::from(out).display());
        }
    }
    println!("{report}");
    app.exit(if passed { 0 } else { 1 });
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
    use super::{base64, files_from_env, FILES_VAR};
    use std::{env, path::PathBuf};

    #[test]
    fn base64_matches_rfc_4648_vectors() {
        let cases = [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")];
        for (input, expected) in cases {
            assert_eq!(base64(input.as_bytes()), expected);
        }
    }

    // The only test that touches CANVIEWER_SMOKE_FILES, so parallel tests
    // cannot see it change.
    #[test]
    fn self_test_files_come_from_the_environment_and_are_off_without_it() {
        let files = vec![PathBuf::from("examples/demo.dbc"), PathBuf::from("third_party/canmatrix/test.arxml")];
        env::set_var(FILES_VAR, env::join_paths(&files).unwrap());
        assert_eq!(files_from_env(), Some(files));
        env::remove_var(FILES_VAR);
        assert_eq!(files_from_env(), None);
    }
}
