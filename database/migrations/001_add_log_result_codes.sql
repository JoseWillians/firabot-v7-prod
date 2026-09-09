-- Migration 001: códigos operacionais e correlação de mensagens nos logs.
-- Mudança aditiva e compatível com o código anterior.

DELIMITER //
DROP PROCEDURE IF EXISTS migrate_logs_result_codes//
CREATE PROCEDURE migrate_logs_result_codes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'result_code'
  ) THEN
    ALTER TABLE logs ADD COLUMN result_code SMALLINT UNSIGNED NULL AFTER error_message;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'correlation_id'
  ) THEN
    ALTER TABLE logs ADD COLUMN correlation_id VARCHAR(191) NULL AFTER result_code;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_logs_result_code'
  ) THEN
    CREATE INDEX idx_logs_result_code ON logs (result_code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_logs_correlation_id'
  ) THEN
    CREATE INDEX idx_logs_correlation_id ON logs (correlation_id);
  END IF;
END//
DELIMITER ;

CALL migrate_logs_result_codes();
DROP PROCEDURE IF EXISTS migrate_logs_result_codes;
