//! Resolver trait the CEL evaluator dispatches against. Two
//! impls today:
//!
//! - [`SlimLinkedOCELResolver`]: in-memory engine path. CEL variable
//!   tokens are `"ev_<idx>"` / `"ob_<idx>"` strings; the resolver
//!   parses them and dereferences the linked OCEL's events / objects
//!   by index.
//!
//! - [`IdBackedOcel`] (in `crate::db_translation::id_ocel`):
//!   SQL-backed path. CEL variable tokens are the OCEL ocel_id
//!   strings themselves; the resolver does a HashMap lookup. No
//!   index allocation.
//!
//! Both impls plug into the same [`crate::cel::evaluate_cel`]
//! function via `Arc<dyn Resolver>`. The closures the CEL evaluator
//! hands to `cel_interpreter::Context` clone the `Arc`, so the 'static
//! lifetime is satisfied naturally without raw-pointer transmutes.

use chrono::{DateTime, FixedOffset};
use process_mining::core::event_data::object_centric::{
    linked_ocel::{
        slim_linked_ocel::{EventOrObjectIndex, InnerIndex},
        LinkedOCELAccess, SlimLinkedOCEL,
    },
    OCELEvent, OCELObject,
};

use crate::preprocessing::linked_ocel::{event_or_object_from_index, OCELNode};

/// Per-resolver lookup over OCEL events and objects keyed by a string
/// token. The token shape is resolver-defined (legacy `"ev_<idx>"`
/// for the in-memory resolver; ocel_id for the SQL resolver). CEL
/// builtins never inspect the token format; they pass it back to
/// the resolver.
pub trait Resolver: Send + Sync {
    /// Look up an event by its variable-binding token. Returns
    /// `Some(OCELEvent)` (owned clone) when the token resolves to an
    /// event, `None` otherwise.
    fn get_event(&self, token: &str) -> Option<OCELEvent>;
    /// Look up an object by its variable-binding token.
    fn get_object(&self, token: &str) -> Option<OCELObject>;
    /// Cheap event-time access for `e.time()`. Returns the same time
    /// the matching `get_event(...).map(|e| e.time)` would, but
    /// implementations are free to short-circuit (in particular the
    /// linked-OCEL resolver avoids cloning the full event).
    fn get_event_time(&self, token: &str) -> Option<DateTime<FixedOffset>>;
    /// Full-dataset event count for `numEvents()`. The CEL string
    /// rewriter substitutes this as an integer literal on the SQL
    /// path; the in-memory path resolves it live.
    fn num_events(&self) -> u64;
    /// Full-dataset object count for `numObjects()`. See
    /// [`Resolver::num_events`].
    fn num_objects(&self) -> u64;
}

/// In-memory engine adapter. Borrows a `SlimLinkedOCEL` for the
/// duration of one `evaluate_cel` call. CEL variable tokens are
/// `"ev_<idx>"` / `"ob_<idx>"` strings produced by
/// `cached_ev_index_name` / `cached_ob_index_name`; the resolver
/// parses the prefix and dereferences the linked OCEL by index.
///
/// Borrow-based on purpose: the in-memory engine threads
/// `&SlimLinkedOCEL` through dozens of call sites and rewiring it to
/// `Arc<SlimLinkedOCEL>` would be a wide refactor for no functional
/// gain. The CEL evaluator captures the resolver inside its closures
/// via a thread-local raw-pointer scaffold (see `cel/mod.rs`); the
/// pointer is set before `Program::execute` and cleared after, so
/// the borrow's lifetime never actually escapes the call.
pub struct SlimLinkedOCELResolver<'a> {
    pub locel: &'a SlimLinkedOCEL,
}

impl<'a> SlimLinkedOCELResolver<'a> {
    pub fn new(locel: &'a SlimLinkedOCEL) -> Self {
        Self { locel }
    }

    fn parse_token(s: &str) -> Option<EventOrObjectIndex> {
        if s.len() < 4 {
            return None;
        }
        let (typ, num) = s.split_at(3);
        let num = num.parse::<InnerIndex>().ok()?;
        match typ {
            "ev_" => Some(EventOrObjectIndex::Event(num.into())),
            "ob_" => Some(EventOrObjectIndex::Object(num.into())),
            _ => None,
        }
    }
}

impl<'a> Resolver for SlimLinkedOCELResolver<'a> {
    fn get_event(&self, token: &str) -> Option<OCELEvent> {
        let idx = Self::parse_token(token)?;
        match event_or_object_from_index(idx, self.locel) {
            OCELNode::Event(ev) => Some(ev),
            OCELNode::Object(_) => None,
        }
    }

    fn get_object(&self, token: &str) -> Option<OCELObject> {
        let idx = Self::parse_token(token)?;
        match event_or_object_from_index(idx, self.locel) {
            OCELNode::Object(ob) => Some(ob),
            OCELNode::Event(_) => None,
        }
    }

    fn get_event_time(&self, token: &str) -> Option<DateTime<FixedOffset>> {
        let idx = Self::parse_token(token)?;
        match idx {
            EventOrObjectIndex::Event(ev_index) => Some(*self.locel.get_ev_time(&ev_index)),
            EventOrObjectIndex::Object(_) => None,
        }
    }

    fn num_events(&self) -> u64 {
        self.locel.get_all_evs().count() as u64
    }
    fn num_objects(&self) -> u64 {
        self.locel.get_all_obs().count() as u64
    }
}
