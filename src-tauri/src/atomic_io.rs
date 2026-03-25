use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use uuid::Uuid;

fn temp_path_for(target: &Path) -> io::Result<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target path has no parent"))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target path has no file name"))?;

    Ok(parent.join(format!(".{file_name}.tmp-{}", Uuid::new_v4())))
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(iter::once(0)).collect();

    let replaced = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if replaced == 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

pub fn write_text_atomic(path: &Path, content: &str) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target path has no parent"))?;
    fs::create_dir_all(parent)?;

    let temp_path = temp_path_for(path)?;
    let mut temp_file: File = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)?;

    temp_file.write_all(content.as_bytes())?;
    temp_file.sync_all()?;
    drop(temp_file);

    if let Err(error) = replace_file(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(())
}

pub async fn write_text_atomic_async(path: PathBuf, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || write_text_atomic(&path, &content))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::write_text_atomic;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("codex-manager-atomic-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn writes_new_file_atomically() {
        let dir = temp_dir();
        let path = dir.join("sample.json");

        write_text_atomic(&path, "{\"ok\":true}").expect("write");

        let content = fs::read_to_string(&path).expect("read");
        assert_eq!(content, "{\"ok\":true}");

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn replaces_existing_file_contents_atomically() {
        let dir = temp_dir();
        let path = dir.join("sample.json");
        fs::write(&path, "old").expect("seed");

        write_text_atomic(&path, "new").expect("replace");

        let content = fs::read_to_string(&path).expect("read");
        assert_eq!(content, "new");

        fs::remove_dir_all(dir).expect("cleanup");
    }
}
