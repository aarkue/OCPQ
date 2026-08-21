//! OCPQ-side, engine-stored values not in the upstream `process_mining` registry (a closed
//! enum). Artifacts cross the binding boundary by value, never as a handle.

use process_mining::core::io::{Exportable, ExtensionWithMime, Importable};
use process_mining::PetriNet;

pub enum OcpqArtifact {
    PetriNet(PetriNet),
}

impl OcpqArtifact {
    /// Every artifact kind, for enumeration (file filters, OS file associations, viewer wiring).
    pub const KINDS: &'static [&'static str] = &["PetriNet"];

    pub fn kind(&self) -> &'static str {
        match self {
            OcpqArtifact::PetriNet(_) => "PetriNet",
        }
    }

    /// Known import formats for a kind. Delegates to the value type's `Importable` impl, so the
    /// extension/MIME set stays in lockstep with the engine's actual parsers (no hardcoding).
    pub fn known_import_formats(kind: &str) -> Vec<ExtensionWithMime> {
        match kind {
            "PetriNet" => <PetriNet as Importable>::known_import_formats(),
            _ => Vec::new(),
        }
    }

    /// Known export formats for a kind (mirrors [`Self::known_import_formats`]).
    pub fn known_export_formats(kind: &str) -> Vec<ExtensionWithMime> {
        match kind {
            "PetriNet" => <PetriNet as Exportable>::known_export_formats(),
            _ => Vec::new(),
        }
    }

    /// Native read: parse a file from a path. Format inferred from the extension.
    pub fn import_from_path(kind: &str, path: &str) -> Result<Self, String> {
        match kind {
            "PetriNet" => Ok(OcpqArtifact::PetriNet(
                PetriNet::import_from_path(path).map_err(|e| format!("{e:?}"))?,
            )),
            other => Err(format!("Unknown artifact kind: {other}")),
        }
    }

    pub fn import_from_bytes(kind: &str, bytes: &[u8], format: &str) -> Result<Self, String> {
        match kind {
            "PetriNet" => Ok(OcpqArtifact::PetriNet(
                PetriNet::import_from_bytes(bytes, format).map_err(|e| format!("{e:?}"))?,
            )),
            other => Err(format!("Unknown artifact kind: {other}")),
        }
    }

    pub fn export_to_bytes(&self, format: &str) -> Result<Vec<u8>, String> {
        match self {
            OcpqArtifact::PetriNet(net) => {
                net.export_to_bytes(format).map_err(|e| format!("{e:?}"))
            }
        }
    }

    pub fn to_json(&self) -> Result<serde_json::Value, String> {
        match self {
            OcpqArtifact::PetriNet(net) => serde_json::to_value(net).map_err(|e| e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal valid PNML: one place, one transition, one arc.
    const PNML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/pnmlcoremodel"><page id="p0">
<place id="p1"><name><text>p1</text></name></place>
<transition id="t1"><name><text>t1</text></name></transition>
<arc id="a1" source="p1" target="t1"/>
</page></net></pnml>"#;

    #[test]
    fn petrinet_round_trips_through_bytes() {
        let a = OcpqArtifact::import_from_bytes("PetriNet", PNML.as_bytes(), "pnml").unwrap();
        assert_eq!(a.kind(), "PetriNet");
        let out = a.export_to_bytes("pnml").unwrap();
        let b = OcpqArtifact::import_from_bytes("PetriNet", &out, "pnml").unwrap();
        assert_eq!(b.kind(), "PetriNet");
        assert!(a.to_json().unwrap().get("places").is_some());
    }

    #[test]
    fn unknown_kind_errors() {
        assert!(OcpqArtifact::import_from_bytes("Nope", b"x", "pnml").is_err());
    }
}
