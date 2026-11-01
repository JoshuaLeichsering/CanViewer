// SPDX-License-Identifier: GPL-2.0-or-later
// Desktop shell for CanViewer: one window that shows the production web build
// (dist/), embedded in the binary. No plugins and no network access: the web
// app does all the work, as it does in the browser. The only addition is a
// self-test for CI (smoke.rs), which exists only when CANVIEWER_SMOKE_FILES
// is set.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod smoke;

fn main() {
    let mut builder = tauri::Builder::default();
    if let Some(files) = smoke::files_from_env() {
        builder = smoke::install(builder, &files);
    }
    builder
        .run(tauri::generate_context!())
        .expect("error while running CanViewer");
}
