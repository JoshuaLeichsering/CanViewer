// Desktop shell for CanViewer: one window that shows the production web build
// (dist/), embedded in the binary. No commands, plugins or network access: the
// web app does all the work, as it does in the browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running CanViewer");
}
