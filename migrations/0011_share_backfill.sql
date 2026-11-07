-- phase: expand
-- Visibility step 2 (design 2026-11-06): every chat, arena round and character card that already exists gets its
-- sharing row, Only me. New items are registered as they are made (server/sharing.js); this one-time insert means an
-- item from before this change is still its owner's, and an old reader that never asks the sharing system fails
-- closed rather than opening it. The tables themselves are 0007_sharing.sql, kept verbatim from openvibe-sdk/share.
-- Repeating this file is a no-op.

INSERT INTO shares (service, kind, resource_id, owner_subject, audience)
SELECT 'exchange', 'chat', id,
       jsonb_build_object('type', CASE WHEN owner LIKE 'gst_%' THEN 'guest' ELSE 'user' END, 'id', owner), 'private'
FROM exchange_chats
WHERE owner IS NOT NULL
ON CONFLICT (service, kind, resource_id) DO NOTHING;

INSERT INTO shares (service, kind, resource_id, owner_subject, audience)
SELECT 'exchange', 'arena-round', id,
       jsonb_build_object('type', CASE WHEN owner LIKE 'gst_%' THEN 'guest' ELSE 'user' END, 'id', owner), 'private'
FROM exchange_arena_rounds
WHERE owner IS NOT NULL
ON CONFLICT (service, kind, resource_id) DO NOTHING;

INSERT INTO shares (service, kind, resource_id, owner_subject, audience)
SELECT 'exchange', 'character', id,
       jsonb_build_object('type', CASE WHEN owner LIKE 'gst_%' THEN 'guest' ELSE 'user' END, 'id', owner),
       CASE audience WHEN 'public' THEN 'public' WHEN 'unlisted' THEN 'link' ELSE 'private' END
FROM exchange_characters
WHERE owner IS NOT NULL
ON CONFLICT (service, kind, resource_id) DO NOTHING;
