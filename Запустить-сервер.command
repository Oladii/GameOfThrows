#!/bin/zsh

print -r -- 'Запускаю локальный сервер GameOfThrows.'
print -r -- 'Оставь это окно открытым, пока играешь.'
print -r -- 'Когда появится строка Local: http://127.0.0.1:5177, вернись в ChatGPT и напиши «готово».'
print -r -- ''

PORT=5177 /usr/local/bin/node '/Users/vb/Documents/ChatGPT/Game/prototype/server.mjs'
game_exit_code=$?

if (( game_exit_code != 0 && game_exit_code != 130 )); then
  print -r -- ''
  print -r -- 'Сервер не запустился. Пришли в чат снимок этого окна.'
  read -r '?Нажми Enter, чтобы закрыть окно.'
fi

exit "$game_exit_code"
