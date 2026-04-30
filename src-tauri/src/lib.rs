use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// Wraps the child process in a Mutex so we can call kill(&mut self) from shared state.
struct ServerProcess(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // In dev mode, beforeDevCommand already starts Express.
            // In release builds, we spawn the bundled server with node.
            if !cfg!(debug_assertions) {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("Failed to resolve resource dir");
                let node_path = resource_dir.join("node");
                let server_path = resource_dir.join("server.mjs");

                // Ask the OS for a free ephemeral port, then release it for Express to claim.
                let port: u16 = {
                    let listener = std::net::TcpListener::bind("127.0.0.1:0")
                        .expect("Failed to find a free port");
                    listener.local_addr().unwrap().port()
                };

                let shell = app.shell();
                match shell
                    .command(node_path.to_string_lossy().to_string())
                    .args([server_path.to_string_lossy().to_string()])
                    .env("FLOWSPACE_PRODUCTION", "1")
                    .env("PORT", port.to_string())
                    .spawn()
                {
                    Ok((mut rx, child)) => {
                        app.manage(ServerProcess(Mutex::new(Some(child))));
                        println!("FlowSpace server started with bundled Node: {:?}", server_path);

                        // Drain stdout/stderr to prevent the child process from
                        // blocking when the OS pipe buffer fills up.
                        tauri::async_runtime::spawn(async move {
                            while let Some(event) = rx.recv().await {
                                match event {
                                    tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                        eprintln!("[server] {}", String::from_utf8_lossy(&line));
                                    }
                                    tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                        println!("[server] {}", String::from_utf8_lossy(&line));
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("Failed to start server with bundled Node {}: {}", node_path.display(), e);
                        app.manage(ServerProcess(Mutex::new(None)));
                    }
                }

                // Poll until the server is ready, then navigate the WebView
                // to http://localhost:<port> so all API calls are same-origin.
                // This avoids mixed-content blocking: the Tauri WebView initially
                // loads from https://tauri.localhost (bundled static files), but
                // fetch() to http://localhost:<port> is blocked by WebKit's
                // mixed-content policy. By navigating to the Express server,
                // the origin becomes http://localhost:<port> and all API calls
                // are same-origin — no CORS, no mixed content.
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    for i in 0..60 {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                            println!("Server is ready on port {} (after {}ms)", port, (i + 1) * 500);
                            // Navigate the WebView to the Express server
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let url = format!("http://localhost:{}", port)
                                    .parse::<tauri::Url>()
                                    .unwrap();
                                match window.navigate(url) {
                                    Ok(()) => println!("WebView navigated to http://localhost:{}", port),
                                    Err(e) => eprintln!("Failed to navigate WebView: {}", e),
                                }
                            }
                            return;
                        }
                        if i % 4 == 3 {
                            println!("Waiting for server... ({}s)", (i + 1) / 2);
                        }
                    }
                    eprintln!("Warning: Server did not respond within 30 seconds");
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                // Only kill when the last window closes
                if app.webview_windows().is_empty() {
                    if let Some(server) = app.try_state::<ServerProcess>() {
                        if let Ok(mut guard) = server.0.lock() {
                            if let Some(child) = guard.take() {
                                if let Err(e) = child.kill() {
                                    eprintln!("Failed to stop FlowSpace server: {}", e);
                                } else {
                                    println!("Server process terminated");
                                }
                            }
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
