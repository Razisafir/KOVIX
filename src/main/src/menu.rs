//! Native application menu for Construct IDE.
//!
//! Provides OS-native menu bar with File, Edit, View, Agent, Help menus.
//! Menu item selections emit `menu-event` to the frontend via Tauri's
//! event system, where the React app dispatches them to Zustand store actions.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Runtime,
};

/// Build the native application menu.
///
/// Called from `Builder::menu()` which passes `&AppHandle`.
/// Returns `tauri::Result<Menu<R>>` as required by the builder API.
pub fn build_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // ── File Menu ────────────────────────────────────────────────────────
    let file_new = MenuItem::with_id(handle, "file:new", "New File", true, Some("CmdOrCtrl+N"))?;
    let file_open_file = MenuItem::with_id(handle, "file:open-file", "Open File...", true, Some("CmdOrCtrl+O"))?;
    let file_open_folder = MenuItem::with_id(handle, "file:open-folder", "Open Folder...", true, Some("CmdOrCtrl+K"))?;
    let file_separator1 = PredefinedMenuItem::separator(handle)?;
    let file_save = MenuItem::with_id(handle, "file:save", "Save", true, Some("CmdOrCtrl+S"))?;
    let file_save_all = MenuItem::with_id(handle, "file:save-all", "Save All", true, Some("CmdOrCtrl+Shift+S"))?;
    let file_separator2 = PredefinedMenuItem::separator(handle)?;
    let file_quit = MenuItem::with_id(handle, "file:quit", "Quit", true, Some("CmdOrCtrl+Q"))?;

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
    )?;

    // ── Edit Menu ────────────────────────────────────────────────────────
    // Use OS-predefined items for Undo/Redo/Cut/Copy/Paste — these get
    // proper OS-localized labels and automatic routing to the webview.
    let edit_undo = PredefinedMenuItem::undo(handle, None)?;
    let edit_redo = PredefinedMenuItem::redo(handle, None)?;
    let edit_separator1 = PredefinedMenuItem::separator(handle)?;
    let edit_cut = PredefinedMenuItem::cut(handle, None)?;
    let edit_copy = PredefinedMenuItem::copy(handle, None)?;
    let edit_paste = PredefinedMenuItem::paste(handle, None)?;

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
    )?;

    // ── View Menu ────────────────────────────────────────────────────────
    let view_command_palette = MenuItem::with_id(handle, "view:command-palette", "Command Palette...", true, Some("CmdOrCtrl+Shift+P"))?;
    let view_separator1 = PredefinedMenuItem::separator(handle)?;
    let view_explorer = MenuItem::with_id(handle, "view:explorer", "Explorer", true, Some("CmdOrCtrl+Shift+E"))?;
    let view_search = MenuItem::with_id(handle, "view:search", "Search", true, Some("CmdOrCtrl+Shift+F"))?;
    let view_separator2 = PredefinedMenuItem::separator(handle)?;
    let view_toggle_sidebar = MenuItem::with_id(handle, "view:toggle-sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+B"))?;
    let view_toggle_right_sidebar = MenuItem::with_id(handle, "view:toggle-right-sidebar", "Toggle Right Sidebar", true, Some("CmdOrCtrl+Shift+B"))?;
    let view_toggle_panel = MenuItem::with_id(handle, "view:toggle-panel", "Toggle Bottom Panel", true, Some("CmdOrCtrl+`"))?;

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
    )?;

    // ── Agent Menu ───────────────────────────────────────────────────────
    let agent_new_chat = MenuItem::with_id(handle, "agent:new-chat", "New Chat", true, Some("CmdOrCtrl+Shift+L"))?;
    let agent_memory = MenuItem::with_id(handle, "agent:memory", "Memory Browser", true, None::<&str>)?;
    let agent_dashboard = MenuItem::with_id(handle, "agent:dashboard", "Agent Dashboard", true, None::<&str>)?;
    let agent_separator = PredefinedMenuItem::separator(handle)?;
    let agent_new_terminal = MenuItem::with_id(handle, "agent:new-terminal", "New Terminal", true, None::<&str>)?;

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
    )?;

    // ── Help Menu ────────────────────────────────────────────────────────
    let help_docs = MenuItem::with_id(handle, "help:documentation", "Documentation", true, None::<&str>)?;
    let help_shortcuts = MenuItem::with_id(handle, "help:shortcuts", "Keyboard Shortcuts", true, None::<&str>)?;
    let help_separator = PredefinedMenuItem::separator(handle)?;
    let help_about = MenuItem::with_id(handle, "help:about", "About Construct", true, None::<&str>)?;

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
    )?;

    // ── Assemble top-level menu ──────────────────────────────────────────
    Menu::with_items(
        handle,
        &[&file_menu, &edit_menu, &view_menu, &agent_menu, &help_menu],
    )
}
