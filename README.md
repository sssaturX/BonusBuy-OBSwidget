# widget

## Автоматическая установка на VPS

После клонирования репозитория на Debian/Ubuntu:

```bash
sudo bash deploy-vps.sh
```

Скрипт найдёт домен существующего сайта и предложит адрес вида
`widget.example.com`. Для запуска без вопроса:

```bash
sudo WIDGET_DOMAIN=widget.example.com bash deploy-vps.sh
```
