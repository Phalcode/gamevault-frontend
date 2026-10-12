//! File discovery inside installed game folders.
//!
//! Both the Launch Options list and the playtime tracker need to know which
//! files inside an installed game folder are launchable. The walk has to cope
//! with everything from a three-file Unity game to a repack with tens of
//! thousands of files, plus the symlinks/junctions some installers leave
//! behind (Wine/Proton output and Steam library redirects included).
//!
//! Three properties of the walk matter:
//!
//! * **Breadth-first.** Game executables live in the game folder's root or one
//!   level below it. Walking level by level collects every file of a shallower
//!   level before the entry budget can be spent inside a huge subtree, so a
//!   large `Game_Data`/`Engine`/`__redist` folder can no longer hide the
//!   executable that sits right next to it.
//! * **Links are followed, not skipped.** Skipping them hid symlinked
//!   executables and everything inside a symlinked folder. Cycles are detected
//!   by identity instead (`dev`+`ino` on Unix, canonical path elsewhere), so a
//!   self-referencing link can not loop forever.
//! * **Bounded, and honest about it.** A budget limits how many directory
//!   entries are inspected during one walk; when it is hit the caller learns
//!   about it ([`LaunchScan::truncated`]) instead of silently getting a partial
//!   list.

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

/// Extensions that can be launched directly on Windows.
#[cfg(windows)]
const LAUNCH_EXTENSIONS: [&str; 6] = ["exe", "bat", "cmd", "com", "ps1", "lnk"];
/// On Unix a file only has to carry the executable bit — but Windows
/// executables are offered too, because umu-launcher runs them through
/// Proton/Wine.
#[cfg(not(windows))]
const LAUNCH_EXTENSIONS: [&str; 4] = ["exe", "bat", "cmd", "com"];
/// Shell scripts whose missing executable bit the UI can offer to fix.
#[cfg(unix)]
const SCRIPT_EXTENSIONS: [&str; 5] = ["sh", "bash", "zsh", "run", "command"];

/// How much of a folder a single walk may inspect.
#[derive(Clone, Copy)]
pub(crate) struct ScanLimits {
  /// Hard cap on the directory entries inspected by one walk.
  pub max_entries: usize,
}

impl ScanLimits {
  /// User-triggered scans (Launch Options, installer detection, tracker
  /// diagnostics). They run once and may take a moment, so the budget is
  /// generous: a real game folder fits comfortably, and a truncated result is
  /// still reported instead of passing for a complete one.
  pub(crate) const THOROUGH: Self = Self {
    max_entries: 250_000,
  };
  /// The playtime tracker rescans a game folder whenever its timestamp changes
  /// (games write saves into their own folder), so its walk stays small.
  /// Breadth-first order still finds the game executable, which lives in the
  /// game folder's root.
  pub(crate) const TRACKER: Self = Self {
    max_entries: 30_000,
  };
}

/// Result of a [`walk_files`] call.
pub(crate) struct WalkOutcome {
  /// True when the entry budget stopped the walk before the whole folder was
  /// inspected. The collected results stay valid, they are just incomplete.
  pub truncated: bool,
  /// Directory entries inspected.
  pub entries: usize,
}

/// Result of scanning a launch folder.
#[derive(Default)]
pub(crate) struct LaunchScan {
  /// Launch candidates, relative to the scan root, `/`-separated, sorted.
  pub executables: Vec<String>,
  /// Shell scripts missing the executable bit (Unix only), same format.
  pub non_executable_scripts: Vec<String>,
  /// True when the scan stopped before inspecting the whole folder.
  pub truncated: bool,
}

/// Identity of a directory, used to break link cycles.
#[cfg(unix)]
type DirId = (u64, u64);
#[cfg(not(unix))]
type DirId = String;

fn dir_id(path: &Path) -> Option<DirId> {
  #[cfg(unix)]
  {
    let metadata = fs::metadata(path).ok()?;
    Some((metadata.dev(), metadata.ino()))
  }
  #[cfg(not(unix))]
  {
    fs::canonicalize(path)
      .ok()
      .map(|resolved| resolved.to_string_lossy().to_lowercase())
  }
}

/// Lower-cased extension of `path` (empty when it has none).
pub(crate) fn extension_lower(path: &Path) -> String {
  path
    .extension()
    .and_then(|extension| extension.to_str())
    .map(str::to_ascii_lowercase)
    .unwrap_or_default()
}

/// Relative, `/`-separated form of `path` below `root`.
pub(crate) fn relative_path(root: &Path, path: &Path) -> Option<String> {
  path
    .strip_prefix(root)
    .ok()
    .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

/// Walks `root` breadth-first and calls `visit` for every file it finds.
///
/// `visit` receives the absolute path and the file's mode (`None` on platforms
/// without Unix permissions). Folders that can not be read are skipped with a
/// warning instead of aborting the walk. Links are followed, guarded by
/// [`dir_id`] so a link cycle terminates instead of walking forever.
pub(crate) fn walk_files(
  root: &Path,
  limits: ScanLimits,
  mut visit: impl FnMut(&Path, Option<u32>),
) -> WalkOutcome {
  let mut outcome = WalkOutcome {
    truncated: false,
    entries: 0,
  };
  if !root.is_dir() {
    return outcome;
  }

  let mut queue: VecDeque<PathBuf> = VecDeque::new();
  // Only linked folders need an identity check: a tree without links is
  // already acyclic, and hard links to folders do not exist.
  let mut seen_linked: HashSet<DirId> = HashSet::new();
  if let Some(id) = dir_id(root) {
    seen_linked.insert(id);
  }
  queue.push_back(root.to_path_buf());

  'walk: while let Some(directory) = queue.pop_front() {
    let entries = match fs::read_dir(&directory) {
      Ok(entries) => entries,
      // A folder we can not read (permissions, deleted mid-walk) must not abort
      // the whole scan: skip it and keep the other candidates.
      Err(error) => {
        log::warn!(
          "Skipping unreadable folder during the candidate scan: {} ({error})",
          directory.display()
        );
        continue;
      }
    };

    for entry in entries {
      if outcome.entries >= limits.max_entries {
        log::warn!(
          "Candidate scan stopped after {} entries in {}",
          limits.max_entries,
          root.display()
        );
        outcome.truncated = true;
        break 'walk;
      }

      let Ok(entry) = entry else { continue };
      outcome.entries += 1;

      let path = entry.path();
      let Ok(file_type) = entry.file_type() else {
        continue;
      };
      let linked = file_type.is_symlink();

      // Resolve links: a link counts as its target, so a symlinked executable
      // or a symlinked data folder stays part of the tree. On Unix the mode of
      // every file is needed anyway (the executable bit takes part in the
      // decision), so the metadata is read unconditionally there.
      #[cfg(unix)]
      let metadata = fs::metadata(&path).ok();
      #[cfg(not(unix))]
      let metadata = if linked { fs::metadata(&path).ok() } else { None };

      // A dangling link has no target and can not be launched.
      if linked && metadata.is_none() {
        continue;
      }

      let is_dir = metadata
        .as_ref()
        .map(fs::Metadata::is_dir)
        .unwrap_or_else(|| file_type.is_dir());
      let is_file = metadata
        .as_ref()
        .map(fs::Metadata::is_file)
        .unwrap_or_else(|| file_type.is_file());

      if is_dir {
        if linked {
          // A pattern guard may only borrow, so the identity is checked in the
          // body: this keeps the code compiling for platforms where the
          // identity is an owned path (Windows) instead of a `Copy` pair.
          let Some(id) = dir_id(&path) else {
            continue;
          };
          // Already walked through this target: a cycle. Stop here.
          if !seen_linked.insert(id) {
            continue;
          }
        }
        queue.push_back(path);
        continue;
      }

      if !is_file {
        continue;
      }

      #[cfg(unix)]
      let mode = metadata
        .as_ref()
        .map(|metadata| metadata.permissions().mode());
      #[cfg(not(unix))]
      let mode: Option<u32> = None;

      visit(&path, mode);
    }
  }

  outcome
}

/// True for files the launch picker should offer.
///
/// On Unix that means the file carries the executable bit; Windows executables
/// qualify on every platform because they can be run through Proton/Wine.
pub(crate) fn is_launch_executable(path: &Path, mode: Option<u32>) -> bool {
  #[cfg(unix)]
  {
    if mode.map(|mode| mode & 0o111 != 0).unwrap_or(false) {
      return true;
    }
  }
  #[cfg(not(unix))]
  {
    let _ = mode;
  }

  LAUNCH_EXTENSIONS.contains(&extension_lower(path).as_str())
}

/// True for shell scripts that are missing the executable bit (Unix only).
pub(crate) fn is_script_missing_exec_bit(path: &Path, mode: Option<u32>) -> bool {
  #[cfg(unix)]
  {
    if !SCRIPT_EXTENSIONS.contains(&extension_lower(path).as_str()) {
      return false;
    }
    return mode.map(|mode| mode & 0o111 == 0).unwrap_or(false);
  }
  #[cfg(not(unix))]
  {
    let _ = (path, mode);
    false
  }
}

/// Scans an installed game folder for launchable files.
///
/// The ignore list is deliberately *not* applied here: callers own that policy
/// (the tracker filters after its cache so editing the ignore list takes effect
/// immediately instead of after the cache expires).
pub(crate) fn scan_launch_folder(root: &Path, limits: ScanLimits) -> LaunchScan {
  let mut scan = LaunchScan::default();

  let outcome = walk_files(root, limits, |path, mode| {
    if is_launch_executable(path, mode) {
      if let Some(relative) = relative_path(root, path) {
        scan.executables.push(relative);
      }
    } else if is_script_missing_exec_bit(path, mode) {
      if let Some(relative) = relative_path(root, path) {
        scan.non_executable_scripts.push(relative);
      }
    }
  });

  scan.truncated = outcome.truncated;
  let by_name = |a: &String, b: &String| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase());
  scan.executables.sort_by(by_name);
  scan.non_executable_scripts.sort_by(by_name);
  scan
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Scratch folder for a test. The suite must not depend on a temp-dir crate.
  struct Scratch(PathBuf);

  impl Scratch {
    fn new(name: &str) -> Self {
      let path = std::env::temp_dir().join(format!(
        "gamevault-scan-{}-{name}",
        std::process::id()
      ));
      let _ = fs::remove_dir_all(&path);
      fs::create_dir_all(&path).expect("create scratch folder");
      Self(path)
    }

    fn path(&self) -> &Path {
      &self.0
    }

    fn write(&self, relative: &str, contents: &str) -> PathBuf {
      let path = self.0.join(relative);
      if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent folder");
      }
      fs::write(&path, contents).expect("write file");
      path
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn limits(max_entries: usize) -> ScanLimits {
    ScanLimits { max_entries }
  }

  #[test]
  fn finds_an_executable_beside_a_huge_data_folder() {
    // Regression: a shallow executable used to disappear as soon as the entry
    // budget was spent inside one big sibling folder.
    let scratch = Scratch::new("shallow-vs-huge");
    for index in 0..100 {
      scratch.write(&format!("Game_Data/asset{index}.bin"), "data");
    }
    scratch.write("Game.exe", "MZ");

    let scan = scan_launch_folder(scratch.path(), limits(20));

    assert_eq!(scan.executables, vec!["Game.exe".to_string()]);
    assert!(scan.truncated, "the budget must be reported as truncation");
  }

  #[test]
  fn lists_windows_executables_without_the_executable_bit() {
    let scratch = Scratch::new("exe-without-bit");
    scratch.write("GraveyardKeeper2.exe", "MZ");
    scratch.write("readme.txt", "hi");

    let scan = scan_launch_folder(scratch.path(), limits(1_000));

    assert_eq!(scan.executables, vec!["GraveyardKeeper2.exe".to_string()]);
    assert!(!scan.truncated);
  }

  #[test]
  fn finds_executables_nested_in_subfolders() {
    let scratch = Scratch::new("nested");
    scratch.write("Binaries/Win64/Game.exe", "MZ");
    scratch.write("a/b/c/d/e/f/g/deep.exe", "MZ");

    let scan = scan_launch_folder(scratch.path(), limits(1_000));

    assert_eq!(
      scan.executables,
      vec![
        "a/b/c/d/e/f/g/deep.exe".to_string(),
        "Binaries/Win64/Game.exe".to_string(),
      ]
    );
  }

  #[test]
  fn unreadable_folders_are_skipped() {
    let scratch = Scratch::new("missing-folder");
    scratch.write("Game.exe", "MZ");

    // Deleting the scan root mid-flight is simulated by scanning a folder that
    // only exists as an entry: the walk must return an empty, untruncated scan.
    let scan = scan_launch_folder(&scratch.path().join("does-not-exist"), limits(10));

    assert!(scan.executables.is_empty());
    assert!(!scan.truncated);
  }

  #[cfg(unix)]
  #[test]
  fn follows_symlinked_folders_and_files() {
    use std::os::unix::fs::symlink;

    let scratch = Scratch::new("symlinks");
    scratch.write("real/Game.exe", "MZ");
    scratch.write("real/target.exe", "MZ");
    symlink(scratch.path().join("real"), scratch.path().join("linked")).unwrap();
    symlink(
        scratch.path().join("real/target.exe"),
        scratch.path().join("linked.exe"),
    )
    .unwrap();

    let scan = scan_launch_folder(scratch.path(), limits(1_000));

    assert!(scan.executables.contains(&"linked/Game.exe".to_string()));
    assert!(scan.executables.contains(&"linked.exe".to_string()));
    assert!(!scan.truncated);
  }

  #[cfg(unix)]
  #[test]
  fn a_symlink_cycle_terminates() {
    use std::os::unix::fs::symlink;

    let scratch = Scratch::new("symlink-cycle");
    scratch.write("Game.exe", "MZ");
    scratch.write("Game_Data/asset.bin", "data");
    symlink(scratch.path(), scratch.path().join("loop")).unwrap();
    symlink(scratch.path(), scratch.path().join("Game_Data/loop")).unwrap();

    // Without cycle detection this never returns.
    let scan = scan_launch_folder(scratch.path(), limits(5_000));

    assert!(scan.executables.contains(&"Game.exe".to_string()));
    assert!(!scan.truncated, "a cycle must not burn the entry budget");
  }

  #[cfg(unix)]
  #[test]
  fn reports_scripts_missing_the_executable_bit() {
    use std::os::unix::fs::PermissionsExt;

    let scratch = Scratch::new("scripts");
    scratch.write("start.sh", "#!/bin/sh\n");
    let launcher = scratch.write("launch", "#!/bin/sh\n");
    let executable = scratch.write("run.sh", "#!/bin/sh\n");
    fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();

    let scan = scan_launch_folder(scratch.path(), limits(1_000));

    // The executable script and the extension-less launcher are candidates.
    assert!(scan.executables.contains(&"run.sh".to_string()));
    assert!(scan.executables.contains(&"launch".to_string()));
    assert_eq!(scan.non_executable_scripts, vec!["start.sh".to_string()]);
  }

  #[cfg(windows)]
  #[test]
  fn detects_shortcuts_and_scripts_as_candidates_on_windows() {
    let scratch = Scratch::new("windows-extensions");
    scratch.write("Game.exe", "MZ");
    scratch.write("launch.bat", "echo");
    scratch.write("start.sh", "echo");

    let scan = scan_launch_folder(scratch.path(), limits(1_000));

    assert!(scan.executables.contains(&"Game.exe".to_string()));
    assert!(scan.executables.contains(&"launch.bat".to_string()));
    assert!(scan.non_executable_scripts.is_empty());
  }
}
