#!/usr/bin/env bash
#
# autosave — salva o seu trabalho no GitHub sem você digitar git.
#
#   bash scripts/autosave.sh          salva uma vez e sai
#   bash scripts/autosave.sh --loop   fica rodando e salva a cada 10 minutos
#
# Intervalo do --loop: AUTOSAVE_INTERVALO=300 bash scripts/autosave.sh --loop
#
# Nunca commita com merge/rebase pela metade (isso gravaria marcadores de
# conflito no código) nem com HEAD desanexado. Arquivos de senha (.env*, .auth/)
# ficam de fora porque o .gitignore já os exclui.

set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

GIT_DIR_PATH="$(git rev-parse --git-dir)"
INTERVALO="${AUTOSAVE_INTERVALO:-600}"

salvar() {
  local branch
  if ! branch="$(git symbolic-ref --quiet --short HEAD)"; then
    echo 'autosave: HEAD desanexado (detached) — não vou commitar aqui.'
    return 0
  fi

  if [ -e "$GIT_DIR_PATH/MERGE_HEAD" ] ||
     [ -d "$GIT_DIR_PATH/rebase-merge" ] ||
     [ -d "$GIT_DIR_PATH/rebase-apply" ]; then
    echo 'autosave: merge/rebase em andamento — resolva os conflitos antes.'
    return 0
  fi

  if [ -z "$(git status --porcelain)" ]; then
    return 0
  fi

  git add -A
  if ! git commit -q -m "autosave: $(date '+%d/%m/%Y %H:%M')"; then
    echo 'autosave: nada para commitar.'
    return 0
  fi
  echo "autosave: commit feito em $branch"

  if git push -q origin "$branch"; then
    echo 'autosave: enviado pro GitHub.'
  else
    echo 'autosave: commit salvo no seu computador, mas o push falhou.'
    echo "          sem internet, ou o GitHub tem commits novos. Rode: git pull origin $branch"
  fi
}

if [ "${1:-}" = '--loop' ]; then
  echo "autosave: salvando a cada ${INTERVALO}s. Ctrl+C para parar."
  while true; do
    salvar
    sleep "$INTERVALO"
  done
else
  salvar
fi
