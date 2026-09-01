ALTER TABLE personalities
DROP CONSTRAINT IF EXISTS personalities_provider_check;

ALTER TABLE personalities
ADD CONSTRAINT personalities_provider_check
CHECK (provider IN ('openai', 'gemini', 'grok', 'elevenlabs', 'hume', 'boson'));

INSERT INTO voices (voice_id, name, provider, status, user_id, config)
VALUES
  ('2b2c8242-f8b7-49b4-a0d7-000000000001', 'chloe', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-sky-50","desc":"A friendly and clear female voice.","sample_url":""}'::jsonb),
  ('2b2c8242-f8b7-49b4-a0d7-000000000002', 'eleanor', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-indigo-50","desc":"A calm, articulate female voice.","sample_url":""}'::jsonb),
  ('2b2c8242-f8b7-49b4-a0d7-000000000003', 'nora', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-violet-50","desc":"A female speaker with a calm, clear tone.","sample_url":""}'::jsonb),
  ('2b2c8242-f8b7-49b4-a0d7-000000000004', 'jake', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-emerald-50","desc":"A male speaker with an energetic tone.","sample_url":""}'::jsonb),
  ('2b2c8242-f8b7-49b4-a0d7-000000000005', 'marcus', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-amber-50","desc":"A male speaker with an enthusiastic tone.","sample_url":""}'::jsonb),
  ('2b2c8242-f8b7-49b4-a0d7-000000000006', 'oliver', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-teal-50","desc":"A calm, articulate male voice.","sample_url":""}'::jsonb),
  ('2b2c8242-f8b7-49b4-a0d7-000000000007', 'yujin', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-rose-50","desc":"A bright, personable female Korean voice.","sample_url":""}'::jsonb),
  ('2b2c8242-f8b7-49b4-a0d7-000000000008', 'jiho', 'boson', 'complete', NULL, '{"emoji":"🎙️","color":"bg-blue-50","desc":"A friendly and reassuring male Korean voice.","sample_url":""}'::jsonb)
ON CONFLICT (voice_id) DO UPDATE SET
  name = EXCLUDED.name,
  provider = EXCLUDED.provider,
  status = EXCLUDED.status,
  user_id = EXCLUDED.user_id,
  config = EXCLUDED.config;
