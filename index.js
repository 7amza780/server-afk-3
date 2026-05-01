const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(8000, () => {
  console.log('Server started');
});

function createBot() {
   const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      auth: config['bot-account']['type'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
   });

   bot.loadPlugin(pathfinder);
   const mcData = require('minecraft-data')(bot.version);
   const defaultMove = new Movements(bot, mcData);
   if (bot.settings) bot.settings.colorsEnabled = false;

   let pendingPromise = Promise.resolve();

   function sendRegister(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/register ${password} ${password}`);
         console.log(`[Auth] Sent /register command.`);

         const timeout = setTimeout(() => {
            bot.removeListener('messagestr', handler);
            console.log('[INFO] Register timeout — assuming already registered.');
            resolve();
         }, 8000);

         function handler(message) {
            const lower = message.toLowerCase();
            console.log(`[ChatLog] ${message}`);

            if (lower.includes('successfully registered') || lower.includes('register success') || lower.includes('registered successfully')) {
               clearTimeout(timeout);
               bot.removeListener('messagestr', handler);
               console.log('[INFO] Registration confirmed.');
               resolve();
            } else if (lower.includes('already registered') || lower.includes('already in use')) {
               clearTimeout(timeout);
               bot.removeListener('messagestr', handler);
               console.log('[INFO] Bot was already registered.');
               resolve();
            } else if (lower.includes('invalid command')) {
               clearTimeout(timeout);
               bot.removeListener('messagestr', handler);
               reject(`Registration failed: Invalid command. Message: "${message}"`);
            }
         }

         bot.on('messagestr', handler);
      });
   }

   function sendLogin(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/login ${password}`);
         console.log(`[Auth] Sent /login command.`);

         const timeout = setTimeout(() => {
            bot.removeListener('messagestr', handler);
            reject('Login timeout — no response from server.');
         }, 8000);

         function handler(message) {
            const lower = message.toLowerCase();
            console.log(`[ChatLog] ${message}`);

            if (lower.includes('successfully logged in') || lower.includes('login success') || lower.includes('logged in successfully') || lower.includes('successful login')) {
               clearTimeout(timeout);
               bot.removeListener('messagestr', handler);
               console.log('[INFO] Login successful.');
               resolve();
            } else if (lower.includes('invalid password') || lower.includes('wrong password')) {
               clearTimeout(timeout);
               bot.removeListener('messagestr', handler);
               reject(`Login failed: Invalid password. Message: "${message}"`);
            } else if (lower.includes('not registered')) {
               clearTimeout(timeout);
               bot.removeListener('messagestr', handler);
               reject(`Login failed: Not registered. Message: "${message}"`);
            }
         }

         bot.on('messagestr', handler);
      });
   }

   bot.once('spawn', () => {
      console.log('\x1b[33m[AfkBot] Bot joined the server', '\x1b[0m');

      if (config.utils['auto-auth'].enabled) {
         console.log('[INFO] Started auto-auth module');

         const password = config.utils['auto-auth'].password;

         pendingPromise = pendingPromise
            .then(() => sendRegister(password))
            .then(() => sendLogin(password))
            .catch(error => console.error('[ERROR]', error));
      }

      if (config.utils['chat-messages'].enabled) {
         console.log('[INFO] Started chat-messages module');
         const messages = config.utils['chat-messages']['messages'];

         if (config.utils['chat-messages'].repeat) {
            const delay = config.utils['chat-messages']['repeat-delay'];
            let i = 0;

            let msg_timer = setInterval(() => {
               bot.chat(`${messages[i]}`);

               if (i + 1 === messages.length) {
                  i = 0;
               } else {
                  i++;
               }
            }, delay * 1000);
         } else {
            messages.forEach((msg) => {
               bot.chat(msg);
            });
         }
      }

      const pos = config.position;

      if (config.position.enabled) {
         console.log(
            `\x1b[32m[Afk Bot] Starting to move to target location (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`
         );
         bot.pathfinder.setMovements(defaultMove);
         bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
      }

      if (config.utils['anti-afk'].enabled) {
         bot.setControlState('jump', true);
         if (config.utils['anti-afk'].sneak) {
            bot.setControlState('sneak', true);
         }
      }

      if (config.utils['auto-sleep'] && config.utils['auto-sleep'].enabled) {
         console.log('[INFO] Started auto-sleep module');

         let isTrying = false;
         let warnedNoBed = false;

         async function trySleep() {
            if (isTrying || bot.isSleeping) return;
            if (bot.time.timeOfDay < 12541 || bot.time.timeOfDay > 23458) {
               warnedNoBed = false;
               return;
            }

            const bed = bot.findBlock({
               matching: (block) => bot.isABed ? bot.isABed(block) : block.name.includes('bed'),
               maxDistance: 16,
            });

            if (!bed) {
               if (!warnedNoBed) {
                  console.log('[AutoSleep] No bed found nearby.');
                  warnedNoBed = true;
               }
               return;
            }

            isTrying = true;
            try {
               console.log('[AutoSleep] Bed found, going to sleep...');
               if (config.utils['anti-afk'].enabled) {
                  bot.setControlState('jump', false);
                  bot.setControlState('sneak', false);
               }
               await bot.sleep(bed);
               console.log('\x1b[32m[AutoSleep] Bot is now sleeping.\x1b[0m');
            } catch (err) {
               console.log(`[AutoSleep] Could not sleep: ${err.message}`);
               if (config.utils['anti-afk'].enabled) {
                  bot.setControlState('jump', true);
                  if (config.utils['anti-afk'].sneak) {
                     bot.setControlState('sneak', true);
                  }
               }
            } finally {
               isTrying = false;
            }
         }

         setInterval(trySleep, 5000);

         bot.on('wake', () => {
            console.log('\x1b[32m[AutoSleep] Bot woke up.\x1b[0m');
            warnedNoBed = false;
            if (config.utils['anti-afk'].enabled) {
               bot.setControlState('jump', true);
               if (config.utils['anti-afk'].sneak) {
                  bot.setControlState('sneak', true);
               }
            }
         });
      }
   });

   bot.on('goal_reached', () => {
      console.log(
         `\x1b[32m[AfkBot] Bot arrived at the target location. ${bot.entity.position}\x1b[0m`
      );
   });

   bot.on('death', () => {
      console.log(
         `\x1b[33m[AfkBot] Bot has died and was respawned at ${bot.entity.position}`,
         '\x1b[0m'
      );
   });

   if (config.utils['auto-reconnect']) {
      bot.on('end', () => {
         setTimeout(() => {
            createBot();
         }, config.utils['auto-recconect-delay']);
      });
   }

   bot.on('kicked', (reason) =>
      console.log(
         '\x1b[33m',
         `[AfkBot] Bot was kicked from the server. Reason: \n${reason}`,
         '\x1b[0m'
      )
   );

   bot.on('error', (err) =>
      console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m')
   );
}

createBot();
