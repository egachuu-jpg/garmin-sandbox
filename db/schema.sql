CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS conversations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  text            TEXT        NOT NULL,
  raw_content     JSONB,
  tool_calls      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gear (
  id                   UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  garmin_gear_uuid     TEXT     UNIQUE,
  name                 TEXT     NOT NULL,
  type                 TEXT     NOT NULL DEFAULT 'running_shoe',
  mileage_offset       NUMERIC(10,2) NOT NULL DEFAULT 0,
  alert_threshold_miles INTEGER NOT NULL DEFAULT 400,
  notes                TEXT,
  retired              BOOLEAN  NOT NULL DEFAULT FALSE,
  retired_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_gear (
  activity_id TEXT NOT NULL,
  gear_id     UUID NOT NULL REFERENCES gear(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_id, gear_id)
);

-- Durable coach memory: subjective facts the coach chooses to remember
-- (injuries, how sessions felt, preferences, decisions). Injected into the
-- system prompt every chat so recall works across days without resending chats.
CREATE TABLE IF NOT EXISTS coach_memory (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT        NOT NULL DEFAULT 'note',
  note        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_memory_created ON coach_memory(created_at DESC);
