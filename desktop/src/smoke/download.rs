//! The self-test's check of the export download. smoke.js saves the first
//! file's message list the way a user does (Export, then Messages as CSV);
//! the download handler in main.rs records what it saw here, and the report
//! gets a `download` entry that says whether the file was saved where the
//! system saves downloads, under the expected name, as a messages CSV.
//! desktop.yml then compares that file byte for byte with the pinned export
//! (e2e/desktop-download-check.mjs).
//!
//! This module uses no Tauri type, so that its tests run without a webview.

use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

/// One call of the download handler.
#[derive(Clone, Debug, PartialEq)]
pub enum Seen {
    Requested { url: String, destination: PathBuf, allowed: bool },
    Finished { url: String, path: Option<PathBuf>, success: bool },
}

static SEEN: Mutex<Vec<Seen>> = Mutex::new(Vec::new());

pub fn record(seen: Seen) {
    SEEN.lock().unwrap_or_else(|e| e.into_inner()).push(seen);
}

pub fn seen() -> Vec<Seen> {
    SEEN.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Whether a download has finished, successfully or not.
pub fn any_finished(seen: &[Seen]) -> bool {
    seen.iter().any(|s| matches!(s, Seen::Finished { .. }))
}

/// How every messages CSV the app exports starts: the byte order mark, then the header.
const CSV_START: &str = "\u{feff}id,idHex,isExtended,name,dlc,canFd,";

/// The report's `download` entry for the export of `expected` (a file name);
/// `ok` is true when it was saved in `download_dir` (where the system saves
/// downloads, when it has such a folder) as a messages CSV.
pub fn check(seen: &[Seen], expected: &str, download_dir: Option<&Path>) -> Value {
    let mut problems: Vec<String> = Vec::new();
    let Some((url, destination, allowed)) = seen.iter().find_map(|s| match s {
        Seen::Requested { url, destination, allowed } => Some((url, destination, *allowed)),
        _ => None,
    }) else {
        return json!({ "expected": expected, "ok": false, "problems": ["the download handler saw no download"] });
    };
    if !url.starts_with("blob:") {
        problems.push(format!("the download came from {url}, not from a blob: URL of the page"));
    }
    if !allowed {
        problems.push("the download handler refused the download".into());
    }
    let finished = seen.iter().find_map(|s| match s {
        Seen::Finished { url: u, path, success } if u == url => Some((path.clone(), *success)),
        _ => None,
    });
    let saved = match finished {
        None => {
            problems.push("the download did not finish".into());
            None
        }
        Some((_, false)) => {
            problems.push("the download failed".into());
            None
        }
        // macOS reports no path: the file is where the handler was told it would go.
        Some((path, true)) => Some(path.unwrap_or_else(|| destination.clone())),
    };
    let mut bytes = None;
    if let Some(path) = &saved {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if without_numbering(&name) != expected {
            problems.push(format!("the file is named {name}, not {expected}"));
        }
        if let Some(dir) = download_dir {
            if !same_dir(path.parent(), dir) {
                problems.push(format!("the file is in {}, not in the Downloads folder {}", parent(path), dir.display()));
            }
        }
        match fs::read(path) {
            Ok(content) => {
                bytes = Some(content.len());
                if !content.starts_with(CSV_START.as_bytes()) {
                    problems.push("the file does not start with the byte order mark and the messages CSV header".into());
                } else if !content.ends_with(b"\r\n") || content.split(|b| *b == b'\n').count() < 3 {
                    problems.push("the file holds no complete message record".into());
                }
            }
            Err(e) => problems.push(format!("cannot read {}: {e}", path.display())),
        }
    }
    json!({
        "expected": expected,
        "url": url,
        "destination": destination.display().to_string(),
        "path": saved.as_ref().map(|p| p.display().to_string()),
        "downloadDir": download_dir.map(|d| d.display().to_string()),
        "bytes": bytes,
        "ok": problems.is_empty(),
        "problems": problems,
    })
}

/// The name without the " (1)" that the system adds when the name is taken
/// (WebView2 before the last extension, wry's WebKit backends before the first).
fn without_numbering(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut rest = name;
    while let Some(at) = rest.find(" (") {
        let after = &rest[at + 2..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        out.push_str(&rest[..at]);
        if digits > 0 && after[digits..].starts_with(')') {
            rest = &after[digits + 1..];
        } else {
            out.push_str(" (");
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

fn same_dir(dir: Option<&Path>, expected: &Path) -> bool {
    let canonical = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    dir.is_some_and(|d| canonical(d) == canonical(expected))
}

fn parent(path: &Path) -> String {
    path.parent().map(|p| p.display().to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "blob:tauri://localhost/2f1c6a52-6f0e-4d3c-9a57-2a1d3b0c9e11";
    const CSV: &str = "\u{feff}id,idHex,isExtended,name,dlc,canFd,j1939Pgn\r\n256,0x100,false,EngineData,8,false,\r\n";

    struct Folder(PathBuf);
    impl Folder {
        fn new(name: &str) -> Folder {
            let dir = std::env::temp_dir().join(format!("canviewer-smoke-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Folder(dir)
        }
        fn write(&self, name: &str, content: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, content).unwrap();
            path
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn saved(path: &Path, reported: bool) -> Vec<Seen> {
        vec![
            Seen::Requested { url: URL.into(), destination: path.to_path_buf(), allowed: true },
            Seen::Finished { url: URL.into(), path: reported.then(|| path.to_path_buf()), success: true },
        ]
    }

    fn problems(report: &Value) -> Vec<String> {
        report["problems"].as_array().unwrap().iter().map(|p| p.as_str().unwrap().to_owned()).collect()
    }

    #[test]
    fn accepts_the_export_saved_in_the_downloads_folder() {
        let folder = Folder::new("ok");
        let path = folder.write("demo.messages.csv", CSV);
        // Windows and Linux report the path; macOS does not, so the requested destination counts.
        for reported in [true, false] {
            let report = check(&saved(&path, reported), "demo.messages.csv", Some(&folder.0));
            assert_eq!(problems(&report), Vec::<String>::new());
            assert_eq!(report["ok"], true);
            assert_eq!(report["bytes"], CSV.len());
        }
    }

    #[test]
    fn accepts_a_name_the_system_numbered() {
        let folder = Folder::new("numbered");
        for name in ["demo.messages (1).csv", "demo (2).messages.csv"] {
            let path = folder.write(name, CSV);
            assert_eq!(check(&saved(&path, true), "demo.messages.csv", Some(&folder.0))["ok"], true, "{name}");
        }
        assert_eq!(without_numbering("a (b).csv"), "a (b).csv");
        assert_eq!(without_numbering("a (12)"), "a");
        assert_eq!(without_numbering("a ("), "a (");
    }

    #[test]
    fn reports_every_way_the_download_can_go_wrong() {
        let folder = Folder::new("wrong");
        let elsewhere = Folder::new("elsewhere");
        let path = folder.write("demo.messages.csv", CSV);
        let expect = |seen: Vec<Seen>, dir: &Path, problem: &str| {
            let report = check(&seen, "demo.messages.csv", Some(dir));
            assert_eq!(report["ok"], false, "{problem}");
            assert!(problems(&report).iter().any(|p| p.contains(problem)), "{problem}: {report}");
        };
        expect(vec![], &folder.0, "saw no download");
        expect(saved(&path, true), &elsewhere.0, "not in the Downloads folder");
        expect(saved(&path, true)[..1].to_vec(), &folder.0, "did not finish");
        expect(
            vec![
                Seen::Requested { url: URL.into(), destination: path.clone(), allowed: true },
                Seen::Finished { url: URL.into(), path: None, success: false },
            ],
            &folder.0,
            "the download failed",
        );
        expect(
            vec![Seen::Requested { url: "https://example.org/demo.messages.csv".into(), destination: path.clone(), allowed: false }],
            &folder.0,
            "not from a blob: URL",
        );
        let other = folder.write("demo.signals.csv", CSV);
        expect(saved(&other, true), &folder.0, "named demo.signals.csv");
        let json = folder.write("demo.messages (3).csv", "{}\n");
        expect(saved(&json, true), &folder.0, "messages CSV header");
        let header = folder.write("demo.messages (4).csv", "\u{feff}id,idHex,isExtended,name,dlc,canFd,\r\n");
        expect(saved(&header, true), &folder.0, "no complete message record");
        let gone = folder.0.join("demo.messages (5).csv");
        expect(saved(&gone, true), &folder.0, "cannot read");
    }

    #[test]
    fn records_and_tells_when_a_download_finished() {
        assert!(!any_finished(&[Seen::Requested { url: URL.into(), destination: PathBuf::new(), allowed: true }]));
        assert!(any_finished(&[Seen::Finished { url: URL.into(), path: None, success: false }]));
        record(Seen::Finished { url: URL.into(), path: None, success: true });
        assert!(seen().contains(&Seen::Finished { url: URL.into(), path: None, success: true }));
    }
}
