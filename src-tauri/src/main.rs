#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(not(target_os = "windows"))]
    match codex_manager_lib::cli::maybe_run_from_env(codex_manager_lib::cli::CliInvocationMode::Auto)
    {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }

    codex_manager_lib::run();
}
