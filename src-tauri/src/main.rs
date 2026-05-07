#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    error::Error,
    fs,
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

const APP_TITLE: &str = "公众号作者跟踪台";
const HOST: &str = "127.0.0.1";
const PORT: u16 = 4318;
const SERVER_BOOT_TIMEOUT: Duration = Duration::from_secs(20);

fn boxed_error(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(std::io::Error::other(message.into()))
}

fn resolve_app_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    }

    app.path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录: {error}"))
}

fn wait_for_server() -> Result<(), String> {
    let started_at = Instant::now();
    let addr = format!("{HOST}:{PORT}");

    while started_at.elapsed() < SERVER_BOOT_TIMEOUT {
        if TcpStream::connect(&addr).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }

    Err("本地服务启动超时，请确认 node 与 Puppeteer 依赖可用".to_string())
}

fn spawn_server<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Child, String> {
    let root_dir = resolve_app_root(app)?;
    let server_script = root_dir.join("server").join("server.mjs");
    if !server_script.exists() {
        return Err(format!("未找到服务入口文件: {}", server_script.display()));
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?
        .join("wechat_articles");
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("无法创建应用数据目录 {}: {error}", data_dir.display()))?;

    let mut command = Command::new("node");
    command
        .arg(&server_script)
        .current_dir(&root_dir)
        .env("PORT", PORT.to_string())
        .env("WECHAT_ARTICLE_DATA_DIR", data_dir.as_os_str())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    command.spawn().map_err(|error| {
        format!("无法启动 Node 本地服务。当前 Tauri 方案依赖系统已安装 node。错误: {error}")
    })
}

fn kill_server(server: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut guard) = server.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let reload_item = MenuItemBuilder::new("重新加载")
        .accelerator("CmdOrCtrl+R")
        .id("reload")
        .build(app)?;

    #[cfg(debug_assertions)]
    let devtools_item = MenuItemBuilder::new("开发者工具")
        .accelerator("CmdOrCtrl+Alt+I")
        .id("devtools")
        .build(app)?;

    #[cfg(not(debug_assertions))]
    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&reload_item)
        .build()?;

    #[cfg(debug_assertions)]
    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&reload_item)
        .separator()
        .item(&devtools_item)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&edit_menu, &view_menu])
        .build()
}

fn main() {
    let server_process: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let server_process_for_setup = Arc::clone(&server_process);
    let server_process_for_exit = Arc::clone(&server_process);

    tauri::Builder::default()
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let child = spawn_server(&app_handle).map_err(boxed_error)?;
            wait_for_server().map_err(boxed_error)?;

            {
                let mut guard = server_process_for_setup
                    .lock()
                    .map_err(|_| boxed_error("无法保存服务进程句柄"))?;
                *guard = Some(child);
            }

            let url = Url::parse(&format!("http://{HOST}:{PORT}/"))
                .map_err(|error| boxed_error(format!("无法创建桌面窗口地址: {error}")))?;

            let menu = build_menu(app.handle())
                .map_err(|error| boxed_error(format!("无法创建应用菜单: {error}")))?;

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title(APP_TITLE)
                .inner_size(1440.0, 960.0)
                .min_inner_size(1100.0, 760.0)
                .resizable(true)
                .menu(menu)
                .build()
                .map_err(|error| boxed_error(format!("无法创建桌面窗口: {error}")))?;

            let window_for_menu = window.clone();
            window.on_menu_event(move |_window, event| match event.id().as_ref() {
                "reload" => {
                    let _ = window_for_menu.eval("location.reload()");
                }
                #[cfg(debug_assertions)]
                "devtools" => {
                    if window_for_menu.is_devtools_open() {
                        window_for_menu.close_devtools();
                    } else {
                        window_for_menu.open_devtools();
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用失败")
        .run(move |_app_handle, event| {
            if let RunEvent::Exit = event {
                kill_server(&server_process_for_exit);
            }
        });
}
