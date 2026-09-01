-- Migration 080: per-physician AI style rules learned from note edits ("Learn" feature)
-- Rules are distilled from AI-original vs physician-edited note pairs and injected
-- into future SOAP / recommendations / requisition-prefill prompts. PHI-free by design.

CREATE TABLE IF NOT EXISTS physician_ai_style_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL CHECK (note_type IN ('soap', 'recommendations_imaging', 'recommendations_referrals')),
  rule_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_physician_ai_style_rules_physician_type
  ON physician_ai_style_rules(physician_id, note_type, sort_order);
