-- Migration 004: retenção opt-in de solicitações de suporte.
-- expires_at fica NULL enquanto a política institucional estiver desativada.

-- Bancos criados antes do fluxo de suporte podem não possuir esta tabela.
-- A criação idempotente mantém a migration segura tanto para instalações novas
-- quanto para ambientes locais atualizados a partir de versões anteriores.
CREATE TABLE IF NOT EXISTS support_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  sector_code VARCHAR(50) NOT NULL DEFAULT 'suporte',
  sector_label VARCHAR(100) NOT NULL DEFAULT 'Suporte',
  status VARCHAR(40) NOT NULL DEFAULT 'novo',
  message_preview VARCHAR(500) NOT NULL,
  internal_note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  CONSTRAINT fk_support_tickets_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_support_tickets_status_created (status, created_at),
  INDEX idx_support_tickets_sector_status (sector_code, status),
  INDEX idx_support_tickets_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
DROP PROCEDURE IF EXISTS migrate_support_retention//
CREATE PROCEDURE migrate_support_retention()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'support_tickets' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE support_tickets ADD COLUMN expires_at TIMESTAMP NULL AFTER resolved_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'support_tickets' AND index_name = 'idx_support_tickets_expires_at'
  ) THEN
    CREATE INDEX idx_support_tickets_expires_at ON support_tickets (expires_at);
  END IF;
END//
DELIMITER ;

CALL migrate_support_retention();
DROP PROCEDURE IF EXISTS migrate_support_retention;
