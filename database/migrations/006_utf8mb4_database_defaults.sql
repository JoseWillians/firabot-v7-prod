-- Padroniza os defaults para novas tabelas e rotinas criadas no banco ativo.
-- Tabelas, colunas e dados existentes nao sao convertidos por esta migration.
ALTER DATABASE DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
