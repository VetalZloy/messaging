# Messaging

Messaging is a system that provides convenient and high-quality service of messages exchanging, both personal and chat.

### Deploy
Messaging requires NodeJS v7.0 or higher, MongoDB 3.4, Redis 4.0

1. Clone or download Projectica
2. Change some properties in default.json
3. Open terminal, change directory to project folder and type:
```bat
npm install
node app.js
```
4. That's all

## Important
Messaging uses Redis to identify client by his `SESSION` cookie. Then Messaging will try to find some corresponding records in Redis. Format of records in Redis should be `useless-data|BEGIN|necessary-data`, thus Messaging will use part after `|BEGIN|`. 