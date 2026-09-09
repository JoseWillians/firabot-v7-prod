-- Migration 002: minimização de dados persistidos nos logs.
-- A aplicação deixa de salvar o conteúdo integral e mantém somente o preview.

ALTER TABLE logs MODIFY COLUMN message TEXT NULL;
