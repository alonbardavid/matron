-- The assistant runs on Anthropic's models only, named as the builder's are,
-- without the `anthropic/` prefix. Any other model it was set to is dropped,
-- and the assistant takes the default again.
UPDATE settings
SET value = substr(value, length('anthropic/') + 1)
WHERE key = 'ask_model' AND value LIKE 'anthropic/%';

DELETE FROM settings WHERE key = 'ask_model' AND value LIKE '@cf/%';
