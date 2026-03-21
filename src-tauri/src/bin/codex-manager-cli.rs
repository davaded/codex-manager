fn main() {
    match codex_manager_lib::cli::maybe_run_from_env(codex_manager_lib::cli::CliInvocationMode::Force)
    {
        Ok(true) | Ok(false) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
