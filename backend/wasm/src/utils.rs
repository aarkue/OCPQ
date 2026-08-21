pub fn set_panic_hook() {
    // Install a panic hook that prints to the browser console.
    // See https://github.com/rustwasm/console_error_panic_hook#readme
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
