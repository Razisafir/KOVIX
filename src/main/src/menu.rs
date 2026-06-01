//! Native application menu for Construct IDE.
//!
//! Provides OS-native menu bar with File, Edit, View, Agent, Help menus.
//! Menu item selections emit `menu:{id}` events to the frontend via Tauri's
//! event system, where the React app dispatches them to Zustand store actions.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, Manager,
};

/// Build the native application menu and attach it to the main window.
///
/// Returns the constructed `Menu` so `lib.rs` can chain `.menu()` on the builder.
/// Errors are logged but not propagated — the app should still open without a menu.
pub fn build_menu(app: &App) -> Menu<tauri::Wry> {
    let handle = app.handle();

    // ── File Menu ────────────────────────────────────────────────────────
    let file_new = MenuItem::with_id(handle, "file:new", "New File", true, Some("CmdOrCtrl+N"))
        .expect("failed to create file:new menu item");
    let file_open_file = MenuItem::with_id(handle, "file:open-file", "Open File...", true, Some("CmdOrCtrl+O"))
        .expect("failed to create file:open-file menu item");
    let file_open_folder = MenuItem::with_id(handle, "file:open-folder", "Open Folder...", true, Some("CmdOrCtrl+K"))
        .expect("failed to create file:open-folder menu item");
    let file_separator1 = PredefinedMenuItem::separator(handle)
        .expect("failed to create separator");
    let file_save = MenuItem::with_id(handle, "file:save", "Save", true, Some("CmdOrCtrl+S"))
        .expect("failed to create file:save menu item");
    let file_save_all = MenuItem::with_id(handle, "file:save-all", "Save All", true, Some("CmdOrCtrl+Shift+S"))
        .expect("failed to create file:save-all menu item");
    let file_separator2 = PredefinedMenuItem::separator(handle)
        .expect("failed to create separator");
    let file_quit = MenuItem::with_id(handle, "file:quit", "Quit", true, Some("CmdOrCtrl+Q"))
        .expect("failed to create file:quit menu item");

    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &file_new,
            &file_open_file,
            &file_open_folder,
            &file_separator1,
            &file_save,
            &file_save_all,
            &file_separator2,
            &file_quit,
        ],
    )
    .expect("failed to create File submenu");

    // ── Edit Menu ────────────────────────────────────────────────────────
    // Use OS-predefined items for Undo/Redo/Cut/Copy/Paste — these get
    // proper OS-localized labels and automatic routing to the webview.
    let edit_undo = PredefinedMenuItem::undo(handle, None)
        .expect("failed to create undo item");
    let edit_redo = PredefinedMenuItem::redo(handle, None)
        .expect("failed to create redo item");
    let edit_separator1 = PredefinedMenuItem::separator(handle)
        .expect("failed to create separator");
    let edit_cut = PredefinedMenuItem::cut(handle, None)
        .expect("failed to create cut item");
    let edit_copy = PredefinedMenuItem::copy(handle, None)
        .expect("failed to create copy item");
    let edit_paste = PredefinedMenuItem::paste(handle, None)
        .expect("failed to create paste item");

    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &edit_undo,
            &edit_redo,
            &edit_separator1,
            &edit_cut,
            &edit_copy,
            &edit_paste,
        ],
    )
    .expect("failed to create Edit submenu");

    // ── View Menu ────────────────────────────────────────────────────────
    let view_command_palette = MenuItem::with_id(handle, "view:command-palette", "Command Palette...", true, Some("CmdOrCtrl+Shift+P"))
        .expect("failed to create view:command-palette menu item");
    let view_separator1 = PredefinedMenuItem::separator(handle)
        .expect("failed to create separator");
    let view_explorer = MenuItem::with_id(handle, "view:explorer", "Explorer", true, Some("CmdOrCtrl+Shift+E"))
        .expect("failed to create view:explorer menu item");
    let view_search = MenuItem::with_id(handle, "view:search", "Search", true, Some("CmdOrCtrl+Shift+F"))
        .expect("failed to create view:search menu item");
    let view_separator2 = PredefinedMenuItem::separator(handle)
        .expect("failed to create separator");
    let view_toggle_sidebar = MenuItem::with_id(handle, "view:toggle-sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+B"))
        .expect("failed to create view:toggle-sidebar menu item");
    let view_toggle_right_sidebar = MenuItem::with_id(handle, "view:toggle-right-sidebar", "Toggle Right Sidebar", true, Some("CmdOrCtrl+Shift+B"))
        .expect("failed to create view:toggle-right-sidebar menu item");
    let view_toggle_panel = MenuItem::with_id(handle, "view:toggle-panel", "Toggle Bottom Panel", true, Some("CmdOrCtrl+`"))
        .expect("failed to create view:toggle-panel menu item");

    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &view_command_palette,
            &view_separator1,
            &view_explorer,
            &view_search,
            &view_separator2,
            &view_toggle_sidebar,
            &view_toggle_right_sidebar,
            &view_toggle_panel,
        ],
    )
    .expect("failed to create View submenu");

    // ── Agent Menu ───────────────────────────────────────────────────────
    let agent_new_chat = MenuItem::with_id(handle, "agent:new-chat", "New Chat", true, Some("CmdOrCtrl+Shift+L"))
        .expect("failed to create agent:new-chat menu item");
    let agent_memory = MenuItem::with_id(handle, "agent:memory", "Memory Browser", true, None)
        .expect("failed to create agent:memory menu item");
    let agent_dashboard = MenuItem::with_id(handle, "agent:dashboard", "Agent Dashboard", true, None)
        .expect("failed to create agent:dashboard menu item");
    let agent_separator = PredefinedMenuItem::separator(handle)
        .expect("failed to create separator");
    let agent_new_terminal = MenuItem::with_id(handle, "agent:new-terminal", "New Terminal", true, None)
        .expect("failed to create agent:new-terminal menu item");

    let agent_menu = Submenu::with_items(
        handle,
        "Agent",
        true,
        &[
            &agent_new_chat,
            &agent_memory,
            &agent_dashboard,
            &agent_separator,
            &agent_new_terminal,
        ],
    )
    .expect("failed to create Agent submenu");

    // ── Help Menu ────────────────────────────────────────────────────────
    let help_docs = MenuItem::with_id(handle, "help:documentation", "Documentation", true, None)
        .expect("failed to create help:documentation menu item");
    let help_shortcuts = MenuItem::with_id(handle, "help:shortcuts", "Keyboard Shortcuts", true, None)
        .expect("failed to create help:shortcuts menu item");
    let help_separator = PredefinedMenuItem::separator(handle)
        .expect("failed to create separator");
    let help_about = MenuItem::with_id(handle, "help:about", "About Construct", true, None)
        .expect("failed to create help:about menu item");

    let help_menu = Submenu::with_items(
        handle,
        "Help",
        true,
        &[
            &help_docs,
            &help_shortcuts,
            &help_separator,
            &help_about,
        ],
    )
    .expect("failed to create Help submenu");

    // ── Assemble top-level menu ──────────────────────────────────────────
    Menu::with_items(
        handle,
        &[&file_menu, &edit_menu, &view_menu, &agent_menu, &help_menu],
    )
    .expect("failed to create application menu")
}
