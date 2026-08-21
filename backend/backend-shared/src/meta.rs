//! Per-object metadata side-table: role, generation, and provenance. Kept separate from
//! `process_mining`'s `AppState` so the registry stays a plain id -> item map.

use std::collections::HashMap;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ItemRole {
    Primary,
    Derived,
    Result,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Provenance {
    pub sources: Vec<String>,
    /// `{fn, args}` JSON for a binding call, or a `"convert:<Kind>"` string for a kind conversion.
    pub op: serde_json::Value,
    pub source_gen: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemMeta {
    pub role: ItemRole,
    pub generation: u64,
    pub provenance: Option<Provenance>,
}

#[derive(Debug, Default)]
pub struct ObjMeta {
    inner: RwLock<HashMap<String, ItemMeta>>,
    /// User-facing display labels, kept as a side-map so renaming a dataset never touches the
    /// lifecycle policy above; lives in the engine so a relabel survives a frontend reload.
    labels: RwLock<HashMap<String, String>>,
}

impl ObjMeta {
    /// Role of `id`; absent entries are treated as `Primary` (plain imported objects
    /// carry no meta).
    pub fn role_of(&self, id: &str) -> ItemRole {
        self.inner
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .map(|m| m.role)
            .unwrap_or(ItemRole::Primary)
    }
    pub fn generation_of(&self, id: &str) -> u64 {
        self.inner
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .map(|m| m.generation)
            .unwrap_or(0)
    }
    pub fn set(&self, id: &str, m: ItemMeta) {
        self.inner
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), m);
    }
    /// The user-facing label for `id`, if one was set; absent means the UI falls back to the id.
    pub fn label_of(&self, id: &str) -> Option<String> {
        self.labels
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }
    /// Set (`Some`) or clear (`None`) the display label for `id`.
    pub fn set_label(&self, id: &str, label: Option<String>) {
        let mut g = self.labels.write().unwrap_or_else(|e| e.into_inner());
        match label {
            Some(l) => {
                g.insert(id.to_string(), l);
            }
            None => {
                g.remove(id);
            }
        }
    }
    pub fn remove(&self, id: &str) {
        self.inner
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        self.labels
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    }
    /// Move `from`'s entry and label onto `to`. Whatever `to` carried is dropped either way: the
    /// item under that id is being replaced, so its old provenance and label no longer describe it.
    pub fn rename(&self, from: &str, to: &str) {
        let mut inner = self.inner.write().unwrap_or_else(|e| e.into_inner());
        match inner.remove(from) {
            Some(m) => inner.insert(to.to_string(), m),
            None => inner.remove(to),
        };
        let mut labels = self.labels.write().unwrap_or_else(|e| e.into_inner());
        match labels.remove(from) {
            Some(l) => labels.insert(to.to_string(), l),
            None => labels.remove(to),
        };
    }
    pub fn bump_generation(&self, id: &str) {
        let mut g = self.inner.write().unwrap_or_else(|e| e.into_inner());
        g.entry(id.to_string())
            .and_modify(|m| m.generation += 1)
            .or_insert(ItemMeta {
                role: ItemRole::Primary,
                generation: 1,
                provenance: None,
            });
    }
    /// Whether `id` should be hidden from object listings (everything that is not a plain
    /// user-facing `Primary` dataset: cached conversions and pipeline intermediates).
    pub fn is_hidden(&self, id: &str) -> bool {
        matches!(self.role_of(id), ItemRole::Derived | ItemRole::Result)
    }
    /// The `source_gen` recorded in `id`'s provenance, if any. Used to validate a cached
    /// conversion against the current generation of its source.
    pub fn provenance_source_gen(&self, id: &str) -> Option<u64> {
        self.inner
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .and_then(|m| m.provenance.as_ref().map(|p| p.source_gen))
    }

    pub fn provenance_of(&self, id: &str) -> Option<Provenance> {
        self.inner
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .and_then(|m| m.provenance.clone())
    }
    /// Remove every entry whose id starts with `prefix`; returns the removed ids.
    pub fn remove_with_prefix(&self, prefix: &str) -> Vec<String> {
        let mut g = self.inner.write().unwrap_or_else(|e| e.into_inner());
        let hit: Vec<String> = g
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        for k in &hit {
            g.remove(k);
        }
        let mut labels = self.labels.write().unwrap_or_else(|e| e.into_inner());
        let label_hit: Vec<String> = labels
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        for k in &label_hit {
            labels.remove(k);
        }
        hit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_and_generation_default_when_absent() {
        let m = ObjMeta::default();
        assert!(matches!(m.role_of("x"), ItemRole::Primary));
        assert_eq!(m.generation_of("x"), 0);
    }

    #[test]
    fn set_then_read_back() {
        let m = ObjMeta::default();
        m.set(
            "d",
            ItemMeta {
                role: ItemRole::Derived,
                generation: 0,
                provenance: None,
            },
        );
        assert!(matches!(m.role_of("d"), ItemRole::Derived));
    }

    #[test]
    fn bump_generation_increments() {
        let m = ObjMeta::default();
        m.bump_generation("s");
        assert_eq!(m.generation_of("s"), 1);
        m.bump_generation("s");
        assert_eq!(m.generation_of("s"), 2);
    }

    #[test]
    fn provenance_source_gen_reads_back() {
        let m = ObjMeta::default();
        assert_eq!(m.provenance_source_gen("absent"), None);
        m.set(
            "ocel__as__SlimLinkedOCEL",
            ItemMeta {
                role: ItemRole::Derived,
                generation: 0,
                provenance: Some(Provenance {
                    sources: vec!["ocel".into()],
                    op: "convert:SlimLinkedOCEL".into(),
                    source_gen: 3,
                }),
            },
        );
        assert_eq!(m.provenance_source_gen("ocel__as__SlimLinkedOCEL"), Some(3));
    }

    #[test]
    fn provenance_of_reads_back() {
        let m = ObjMeta::default();
        assert!(m.provenance_of("absent").is_none());
        m.set(
            "d",
            ItemMeta {
                role: ItemRole::Primary,
                generation: 0,
                provenance: Some(Provenance {
                    sources: vec!["s".into()],
                    op: "op".into(),
                    source_gen: 2,
                }),
            },
        );
        let p = m.provenance_of("d").unwrap();
        assert_eq!(p.sources, vec!["s".to_string()]);
        assert_eq!(p.source_gen, 2);
    }

    #[test]
    fn is_hidden_for_derived_and_result_only() {
        let m = ObjMeta::default();
        m.set(
            "d",
            ItemMeta {
                role: ItemRole::Derived,
                generation: 0,
                provenance: None,
            },
        );
        m.set(
            "r",
            ItemMeta {
                role: ItemRole::Result,
                generation: 0,
                provenance: None,
            },
        );
        assert!(m.is_hidden("d"));
        assert!(m.is_hidden("r"));
        assert!(!m.is_hidden("primary-or-absent"));
    }

    #[test]
    fn rename_carries_the_entry_and_the_label_over() {
        let m = ObjMeta::default();
        m.set(
            "scratch",
            ItemMeta {
                role: ItemRole::Primary,
                generation: 4,
                provenance: Some(Provenance {
                    sources: vec!["src".into()],
                    op: "op".into(),
                    source_gen: 1,
                }),
            },
        );
        m.set_label("scratch", Some("Extracted".into()));
        m.rename("scratch", "ocel");
        assert_eq!(m.generation_of("ocel"), 4);
        assert_eq!(m.provenance_of("ocel").unwrap().sources, vec!["src"]);
        assert_eq!(m.label_of("ocel").as_deref(), Some("Extracted"));
        assert!(m.provenance_of("scratch").is_none());
        assert!(m.label_of("scratch").is_none());
    }

    /// The destination's old metadata described the object being replaced, so a source that
    /// carries none has to clear it rather than leave it attached to different data.
    #[test]
    fn rename_from_an_entryless_id_clears_the_destination() {
        let m = ObjMeta::default();
        m.set(
            "ocel",
            ItemMeta {
                role: ItemRole::Primary,
                generation: 9,
                provenance: Some(Provenance {
                    sources: vec!["old".into()],
                    op: "op".into(),
                    source_gen: 0,
                }),
            },
        );
        m.set_label("ocel", Some("Old".into()));
        m.rename("scratch", "ocel");
        assert!(m.provenance_of("ocel").is_none());
        assert!(m.label_of("ocel").is_none());
        assert_eq!(m.generation_of("ocel"), 0);
    }

    #[test]
    fn remove_with_prefix_evicts_matches_only() {
        let m = ObjMeta::default();
        m.set(
            "ocel__as__SlimLinkedOCEL",
            ItemMeta {
                role: ItemRole::Derived,
                generation: 0,
                provenance: None,
            },
        );
        m.set(
            "other",
            ItemMeta {
                role: ItemRole::Primary,
                generation: 0,
                provenance: None,
            },
        );
        let removed = m.remove_with_prefix("ocel__as__");
        assert_eq!(removed, vec!["ocel__as__SlimLinkedOCEL".to_string()]);
        assert!(matches!(m.role_of("other"), ItemRole::Primary));
    }
}
