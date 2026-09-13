-- Word subtype: refines the part of speech (verb → Godan/Ichidan/Irregular,
-- adjective → i-adjective/na-adjective, noun → common/proper…).
--
-- Optional, free text, kept in step with `pos` by the UI. NULL = no subtype.

ALTER TABLE words ADD COLUMN subtype TEXT;
