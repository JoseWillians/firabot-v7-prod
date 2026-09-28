#!/bin/sh
set -eu

: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD é obrigatório}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE é obrigatório}"
: "${FIRABOT_MIGRATION_DB_PASSWORD:?FIRABOT_MIGRATION_DB_PASSWORD é obrigatório}"
: "${FIRABOT_APP_DB_PASSWORD:?FIRABOT_APP_DB_PASSWORD é obrigatório}"

case "$MYSQL_DATABASE" in
  ''|*[!A-Za-z0-9_]*)
    echo 'MYSQL_DATABASE deve conter apenas letras, números e underscores.' >&2
    exit 1
    ;;
esac

if [ "${#MYSQL_DATABASE}" -gt 64 ]; then
  echo 'MYSQL_DATABASE excede 64 caracteres.' >&2
  exit 1
fi

for password_name in FIRABOT_MIGRATION_DB_PASSWORD FIRABOT_APP_DB_PASSWORD; do
  if [ "$password_name" = FIRABOT_MIGRATION_DB_PASSWORD ]; then
    password_value="$FIRABOT_MIGRATION_DB_PASSWORD"
  else
    password_value="$FIRABOT_APP_DB_PASSWORD"
  fi
  case "$password_value" in
    *[!A-Fa-f0-9]*|'')
      echo "$password_name deve ser hexadecimal." >&2
      exit 1
      ;;
  esac

  if [ "${#password_value}" -lt 32 ]; then
    echo "$password_name deve ter pelo menos 32 caracteres." >&2
    exit 1
  fi
done

if [ "$FIRABOT_MIGRATION_DB_PASSWORD" = "$FIRABOT_APP_DB_PASSWORD" ] ||
   [ "$MYSQL_ROOT_PASSWORD" = "$FIRABOT_MIGRATION_DB_PASSWORD" ] ||
   [ "$MYSQL_ROOT_PASSWORD" = "$FIRABOT_APP_DB_PASSWORD" ]; then
  echo 'As senhas de root, manutenção e runtime devem ser diferentes.' >&2
  exit 1
fi

export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
mysql --protocol=TCP --host="${MYSQL_HOST:-mysql}" --user=root "$MYSQL_DATABASE" <<SQL
CREATE USER IF NOT EXISTS 'firabot_migrator'@'%' IDENTIFIED BY '$FIRABOT_MIGRATION_DB_PASSWORD';
ALTER USER 'firabot_migrator'@'%' IDENTIFIED BY '$FIRABOT_MIGRATION_DB_PASSWORD';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'firabot_migrator'@'%';
GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO 'firabot_migrator'@'%';
CREATE USER IF NOT EXISTS 'firabot_app'@'%' IDENTIFIED BY '$FIRABOT_APP_DB_PASSWORD';
ALTER USER 'firabot_app'@'%' IDENTIFIED BY '$FIRABOT_APP_DB_PASSWORD';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'firabot_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`$MYSQL_DATABASE\`.* TO 'firabot_app'@'%';
DROP USER IF EXISTS 'firabot'@'%';
SQL
unset MYSQL_PWD

echo 'Usuário de runtime provisionado com permissões mínimas.'
