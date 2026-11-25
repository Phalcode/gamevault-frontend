fn main() {
  // `stronghold-runtime` depends on `windows` 0.36, whose merged `windows.lib`
  // also provides `WaitOnAddress`. That archive is searched before the default
  // `synchronization.lib`, so the Rust standard library's wait primitive gets
  // bound to `vertdll.dll` instead of `api-ms-win-core-synch-l1-2-0.dll`. The
  // enclave implementation in vertdll dereferences a null shared-data pointer
  // outside an enclave, so the first contended mutex wait crashes the app with
  // STATUS_ACCESS_VIOLATION. Linking `synchronization.lib` explicitly makes the
  // API-set import win.
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
    && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
  {
    println!("cargo:rustc-link-lib=synchronization");
  }
  tauri_build::build()
}
