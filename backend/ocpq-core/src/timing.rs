//! `Instant::now()` panics on wasm32, so this shim keeps timing diagnostics working on native
//! without aborting queries in the browser (`Duration` itself is fine on wasm32).

#[cfg(not(target_arch = "wasm32"))]
pub struct Timer(std::time::Instant);

#[cfg(target_arch = "wasm32")]
pub struct Timer;

impl Timer {
    #[must_use]
    #[cfg(not(target_arch = "wasm32"))]
    pub fn start() -> Self {
        Self(std::time::Instant::now())
    }

    #[must_use]
    #[cfg(target_arch = "wasm32")]
    pub fn start() -> Self {
        Self
    }

    /// Time since [`Timer::start`], or zero where there is no clock.
    #[must_use]
    #[cfg(not(target_arch = "wasm32"))]
    pub fn elapsed(&self) -> std::time::Duration {
        self.0.elapsed()
    }

    #[must_use]
    #[cfg(target_arch = "wasm32")]
    pub fn elapsed(&self) -> std::time::Duration {
        std::time::Duration::ZERO
    }
}
