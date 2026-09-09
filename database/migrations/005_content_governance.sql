-- Migration 005: metadados editoriais e validade para links e editais.
-- Campos nulos preservam o conteúdo atual até que o IFMA defina responsáveis
-- e calendário de revisão; itens vencidos deixam de ser exibidos pelo bot.

DELIMITER //
DROP PROCEDURE IF EXISTS migrate_content_governance//
CREATE PROCEDURE migrate_content_governance()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'important_links' AND column_name = 'source') THEN
    ALTER TABLE important_links ADD COLUMN source VARCHAR(180) NULL AFTER sort_order;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'important_links' AND column_name = 'content_owner') THEN
    ALTER TABLE important_links ADD COLUMN content_owner VARCHAR(120) NULL AFTER source;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'important_links' AND column_name = 'reviewed_at') THEN
    ALTER TABLE important_links ADD COLUMN reviewed_at TIMESTAMP NULL AFTER content_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'important_links' AND column_name = 'expires_at') THEN
    ALTER TABLE important_links ADD COLUMN expires_at TIMESTAMP NULL AFTER reviewed_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'important_links' AND index_name = 'idx_important_links_expires_at') THEN
    CREATE INDEX idx_important_links_expires_at ON important_links (expires_at);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notices' AND column_name = 'content_owner') THEN
    ALTER TABLE notices ADD COLUMN content_owner VARCHAR(120) NULL AFTER sort_order;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notices' AND column_name = 'reviewed_at') THEN
    ALTER TABLE notices ADD COLUMN reviewed_at TIMESTAMP NULL AFTER content_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notices' AND column_name = 'expires_at') THEN
    ALTER TABLE notices ADD COLUMN expires_at TIMESTAMP NULL AFTER reviewed_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'notices' AND index_name = 'idx_notices_expires_at') THEN
    CREATE INDEX idx_notices_expires_at ON notices (expires_at);
  END IF;
END//
DELIMITER ;

CALL migrate_content_governance();
DROP PROCEDURE IF EXISTS migrate_content_governance;
