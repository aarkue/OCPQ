//! `IdBackedOcel`: lightweight ocel_id-keyed OCEL store used by the
//! SQL execution path.
//!
//! Stores `OCELEvent` / `OCELObject` records in `HashMap<String,
//! OCELEvent>` / `HashMap<String, OCELObject>` keyed by ocel_id. No
//! `EventIndex` / `ObjectIndex` allocation. The
//! [`crate::cel::resolver::Resolver`] impl below lets the CEL evaluator
//! dispatch attribute lookups directly by ocel_id.

use chrono::{DateTime, FixedOffset};
use process_mining::core::event_data::object_centric::{OCELEvent, OCELObject};
use std::collections::HashMap;

use crate::cel::resolver::Resolver;

#[derive(Default, Debug)]
pub struct IdBackedOcel {
    pub events: HashMap<String, OCELEvent>,
    pub objects: HashMap<String, OCELObject>,
    /// Full-dataset event count (read once via `SELECT COUNT(*) FROM event`).
    /// Used to answer `numEvents()` honestly even though `events` only
    /// holds the subset the bindings touch.
    pub total_events: u64,
    /// Full-dataset object count. See [`Self::total_events`].
    pub total_objects: u64,
}

impl IdBackedOcel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert_event(&mut self, ev: OCELEvent) {
        self.events.insert(ev.id.clone(), ev);
    }
    pub fn insert_object(&mut self, ob: OCELObject) {
        self.objects.insert(ob.id.clone(), ob);
    }
}

impl Resolver for IdBackedOcel {
    fn get_event(&self, token: &str) -> Option<OCELEvent> {
        self.events.get(token).cloned()
    }
    fn get_object(&self, token: &str) -> Option<OCELObject> {
        self.objects.get(token).cloned()
    }
    fn get_event_time(&self, token: &str) -> Option<DateTime<FixedOffset>> {
        self.events.get(token).map(|e| e.time)
    }
    fn num_events(&self) -> u64 {
        self.total_events
    }
    fn num_objects(&self) -> u64 {
        self.total_objects
    }
}
