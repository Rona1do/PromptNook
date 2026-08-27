mod backup;
mod db;
mod export;
mod models;
mod repository;
mod resources;
mod storage;
mod translation;

use db::PromptVaultState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = PromptVaultState::initialize()
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            app.manage(state);
            let scan_handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = scan_handle.state::<PromptVaultState>();
                let _ = resources::scan_resources_inner(&state);
            });
            let backup_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(10 * 60));
                let state = backup_handle.state::<PromptVaultState>();
                let _ = backup::create_automatic_backup_if_due(&state, true);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            repository::health_check,
            repository::get_dashboard,
            repository::list_recipes,
            repository::get_recipe,
            repository::save_recipe,
            repository::delete_recipe,
            repository::list_recipe_tags,
            repository::list_snippets,
            repository::get_snippet,
            repository::save_snippet,
            repository::increment_snippet_usage,
            repository::delete_snippet,
            repository::list_categories,
            repository::save_category,
            repository::delete_category,
            repository::list_tips,
            repository::save_tip,
            repository::delete_tip,
            repository::search_all,
            repository::list_trash,
            repository::restore_item,
            repository::purge_item,
            repository::empty_trash,
            repository::list_revisions,
            repository::get_settings,
            repository::save_settings,
            resources::list_resources,
            resources::save_resource,
            resources::scan_resources,
            resources::list_download_loras,
            resources::import_download_loras,
            storage::import_asset,
            storage::get_asset_data,
            storage::detach_asset,
            storage::garbage_collect_assets,
            translation::translate_text,
            translation::save_translation_override,
            translation::import_glossary_csv,
            translation::save_translation_api_key,
            translation::has_translation_api_key,
            backup::create_backup,
            backup::list_backups,
            backup::restore_backup,
            backup::import_promptvault,
            export::export_data,
        ])
        .build(tauri::generate_context!())
        .expect("PromptNook failed to start");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<PromptVaultState>();
            if let Ok(conn) = state.db.lock() {
                let _ = db::checkpoint_wal(&conn);
            }
            let _ = backup::create_automatic_backup_if_due(&state, false);
        }
    });
}
