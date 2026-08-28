use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;

static EMBED_BASE: Mutex<Option<String>> = Mutex::new(None);

/// Start a loopback HTTP server that serves a small HTML page embedding the
/// YouTube IFrame player.
///
/// YouTube's embedded player requires a valid HTTP Referer/origin. The
/// `tauri://localhost` protocol used by packaged builds on Linux/macOS sends no
/// HTTP Referer, so YouTube refuses to configure the player and shows
/// `Error 153` (tauri-apps/tauri#14422). Serving the embed page from a real
/// `http://127.0.0.1:<port>` origin gives YouTube a valid HTTP origin, so
/// inline playback also works in the production app.
///
/// This is best-effort: if the server can't bind, `embed_base()` returns `None`
/// and the frontend falls back to a direct YouTube embed (which still works in
/// `tauri dev`).
pub fn start_embed_server() {
  let Ok(listener) = TcpListener::bind("127.0.0.1:0") else {
    return;
  };

  let Ok(addr) = listener.local_addr() else {
    return;
  };

  *EMBED_BASE.lock().unwrap() = Some(format!("http://127.0.0.1:{}", addr.port()));

  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else { continue };
      std::thread::spawn(move || {
        let _ = handle_connection(&mut stream);
      });
    }
  });
}

pub fn embed_base() -> Option<String> {
  EMBED_BASE.lock().unwrap().clone()
}

#[tauri::command]
pub(crate) fn youtube_embed_base() -> Option<String> {
  embed_base()
}

fn handle_connection(stream: &mut std::net::TcpStream) -> std::io::Result<()> {
  let mut buf = [0u8; 4096];
  let n = stream.read(&mut buf)?;
  if n == 0 {
    return Ok(());
  }

  let request = String::from_utf8_lossy(&buf[..n]);
  let first_line = request.lines().next().unwrap_or("").to_string();
  let path = first_line.split_whitespace().nth(1).unwrap_or("/").to_string();

  let (status, body) = dispatch(&path);

  let response = format!(
    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
    body.len()
  );

  stream.write_all(response.as_bytes())?;
  stream.flush()?;
  Ok(())
}

fn dispatch(path: &str) -> (&'static str, String) {
  let Some(query) = path.split('?').nth(1) else {
    return ("404 Not Found", "<h1>Not found</h1>".to_string());
  };

  let params = parse_query(query);
  let Some(video_id) = params
    .iter()
    .find(|(k, _)| k == "v")
    .map(|(_, v)| v)
    .filter(|v| v.len() == 11)
  else {
    return (
      "400 Bad Request",
      "<h1>Missing or invalid video id</h1>".to_string(),
    );
  };

  let autoplay = params.iter().any(|(k, v)| k == "autoplay" && v == "1");
  let mute = params.iter().any(|(k, v)| k == "mute" && v == "1");

  ("200 OK", embed_page(video_id, autoplay, mute))
}

fn parse_query(query: &str) -> Vec<(String, String)> {
  query
    .split('&')
    .filter_map(|pair| {
      let mut parts = pair.splitn(2, '=');
      let key = parts.next()?;
      let value = parts.next().unwrap_or("");
      Some((key.to_string(), value.to_string()))
    })
    .collect()
}

fn embed_page(video_id: &str, autoplay: bool, mute: bool) -> String {
  let mut extra = String::new();
  if autoplay {
    extra.push_str("&autoplay=1");
  }
  if mute {
    extra.push_str("&mute=1");
  }

  format!(
    r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>*{{margin:0;padding:0;box-sizing:border-box}}html,body{{width:100%;height:100%;overflow:hidden;background:#000}}iframe{{width:100%;height:100%;border:0}}</style>
</head>
<body>
<iframe src="https://www.youtube.com/embed/{video_id}?playsinline=1&rel=0&fs=0{extra}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body>
</html>"#
  )
}
