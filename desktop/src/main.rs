// Desktop shell for CanViewer: one window that shows the production web build
// (dist/), embedded in the binary. No plugins and no network access: the web
// app does all the work, as it does in the browser. The only addition is a
// self-test for CI (smoke.rs), which exists only when CANVIEWER_SMOKE_FILES
// is set.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod smoke;

use tauri::webview::DownloadEvent;

fn main() {
    let mut builder = tauri::Builder::default().setup(|app| {
        // The window is described in tauri.conf.json ("create": false) and
        // built here, because only a window built in code can take a download
        // handler.
        let config = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == "main")
            .ok_or("tauri.conf.json describes no window labelled main")?;
        tauri::WebviewWindowBuilder::from_config(app.handle(), config)?
            .on_download(|_webview, event| allow_download(&event))
            .build()?;
        Ok(())
    });
    if let Some(files) = smoke::files_from_env() {
        builder = smoke::install(builder, &files);
    }
    builder
        .run(tauri::generate_context!())
        .expect("error while running CanViewer");
}

/// The export menu saves its files as blob: downloads that the page makes
/// itself. Without a download handler WKWebView (macOS) cancels them; with
/// this one every system saves them to the Downloads folder, under the
/// suggested name, numbered if that name is taken. Downloads from anywhere
/// else are refused: the app has no reason to fetch files.
fn allow_download(event: &DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, .. } => url.scheme() == "blob",
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::allow_download;
    use std::path::PathBuf;
    use tauri::webview::DownloadEvent;

    #[test]
    fn saves_the_pages_own_blob_downloads_only() {
        let mut destination = PathBuf::from("demo.messages.csv");
        let cases = [
            ("blob:tauri://localhost/2f1c6a52-6f0e-4d3c-9a57-2a1d3b0c9e11", true),
            ("blob:http://tauri.localhost/2f1c6a52-6f0e-4d3c-9a57-2a1d3b0c9e11", true),
            ("https://example.org/demo.messages.csv", false),
            ("tauri://localhost/index.html", false),
        ];
        for (url, allowed) in cases {
            let event = DownloadEvent::Requested { url: url.parse().unwrap(), destination: &mut destination };
            assert_eq!(allow_download(&event), allowed, "{url}");
        }
    }
}
