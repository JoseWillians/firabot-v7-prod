-- Migration 003: identifica separadamente JID do WhatsApp e telefone E.164.
-- phone_number permanece como chave legada para preservar relações existentes.

DELIMITER //
DROP PROCEDURE IF EXISTS migrate_user_identities//
CREATE PROCEDURE migrate_user_identities()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'whatsapp_jid'
  ) THEN
    ALTER TABLE users ADD COLUMN whatsapp_jid VARCHAR(191) NULL AFTER phone_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'phone_e164'
  ) THEN
    ALTER TABLE users ADD COLUMN phone_e164 VARCHAR(20) NULL AFTER whatsapp_jid;
  END IF;

  UPDATE users
     SET whatsapp_jid = COALESCE(whatsapp_jid, phone_number),
         phone_e164 = CASE
           WHEN phone_e164 IS NOT NULL THEN phone_e164
           WHEN phone_number LIKE '%@s.whatsapp.net' THEN SUBSTRING_INDEX(phone_number, '@', 1)
           ELSE NULL
         END;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_whatsapp_jid'
  ) THEN
    CREATE INDEX idx_users_whatsapp_jid ON users (whatsapp_jid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_phone_e164'
  ) THEN
    CREATE INDEX idx_users_phone_e164 ON users (phone_e164);
  END IF;
END//
DELIMITER ;

CALL migrate_user_identities();
DROP PROCEDURE IF EXISTS migrate_user_identities;
