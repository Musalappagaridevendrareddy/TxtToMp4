-- Uploaded files carried alongside a question.
--
-- An upload is evidence, never a replacement for the question, so this is
-- additive and nullable: every existing row and every text-only request stays
-- valid with no backfill.
--
-- Shape: [{"filename": "notes.pdf", "path": "uploads/notes.pdf", "bytes": 20481}]
-- `path` is relative to the job's work directory, so the rows survive the
-- render root being moved or remounted.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
