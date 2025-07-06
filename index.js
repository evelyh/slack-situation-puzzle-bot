const { WebClient } = require('@slack/web-api');
const { createEventAdapter } = require('@slack/events-api');
const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const fs = require('fs');
const serverlessExpress = require('@vendia/serverless-express');
require('dotenv').config();

const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackToken = process.env.SLACK_BOT_TOKEN;
const gpt4oApiKey = process.env.GPT4O_API_KEY;

const app = express();
const port = process.env.PORT || 3000;

const slackEvents = createEventAdapter(slackSigningSecret);
const webClient = new WebClient(slackToken);

const openai = new OpenAI({
  apiKey: gpt4oApiKey,
});

const customizationPrompt = fs.readFileSync('./puzzle_prompt.txt', 'utf-8').replace(/\n/g, ' ');
const generatePuzzlePrompt = "Generate a creative and engaging situation puzzle. Provide a prompt and a detailed answer.";
const formatPrompt = 'Please provide the output in the following format: "Prompt: <puzzle prompt> Answer: <detailed answer>".';

app.use('/slack/events', slackEvents.expressMiddleware());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Define the sessions object to store game sessions
const sessions = {};

// // Middleware to verify Slack requests
// app.use((req, res, next) => {
//   const slackSignature = req.headers['x-slack-signature'];
//   const slackTimestamp = req.headers['x-slack-request-timestamp'];

//   // Protect against replay attacks
//   const time = Math.floor(new Date().getTime() / 1000);
//   if (Math.abs(time - slackTimestamp) > 300) {
//     return res.status(400).send('Ignore this request.');
//   }

//   const sigBasestring = `v0:${slackTimestamp}:${JSON.stringify(req.body)}`;
//   const mySignature = `v0=${crypto
//     .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
//     .update(sigBasestring, 'utf8')
//     .digest('hex')}`;

//   if (crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(slackSignature, 'utf8'))) {
//     next();
//   } else {
//     res.status(400).send('Verification failed');
//   }
// });

app.post('/slack/commands', async (req, res) => {
  const { command, text, user_id } = req.body;

  if (command === '/start-puzzle') {
    const usersList = [user_id, ...text.split(' ').map(user => user.replace('@', ''))];
    const numberOfUsers = usersList.length;

    if (numberOfUsers < 3) {
      res.status(200).send('Please invite at least 2 other users along with yourself for a total of at least 3 participants.');
      return;
    }

    try {
      const createGames = async (group) => {
        const channelName = `puzzle-game-${Date.now()}`;
        const createChannelResponse = await webClient.conversations.create({
          name: channelName,
          is_private: true,
        });
        const channelId = createChannelResponse.channel.id;
        await webClient.conversations.invite({
          channel: channelId,
          users: group.join(',')
        });
        await webClient.chat.postMessage({
          channel: channelId,
          text: `Welcome to the Situation Puzzle Game!`
        });

        try {
          const puzzleResponse = await openai.createChatCompletion({
            model: "gpt-4o",
            messages: [
              { role: "system", content: `${generatePuzzlePrompt} ${formatPrompt}` }
            ],
            max_tokens: 300,
          });

          const puzzle = puzzleResponse.data.choices[0].message.content;
          const [prompt, ...answerParts] = puzzle.split('Answer:');
          const answer = answerParts.join('Answer:').trim();

          sessions[channelId] = {
            puzzle: { prompt: prompt.trim(), answer },
            conversationHistory: [],
            noCount: 0,
            solved: false,
          };

          await webClient.chat.postMessage({
            channel: channelId,
            text: `Here is your puzzle: ${prompt.trim()}`
          });
        } catch (error) {
          console.error("Failed to generate puzzle:", error);
        }
      };

      // Group users into batches of 3
      for (let i = 0; i < numberOfUsers; i += 3) {
        const group = usersList.slice(i, i + 3);
        if (group.length === 1 && numberOfUsers > 4) {
          break;
        } else if (group.length < 3 && group.length > 1) {
          await createGames(group);
        } else if (group.length === 3) {
          await createGames(group);
        }
      }

      res.status(200).send('Games started successfully.');

    } catch (error) {
      console.error(error);
      res.status(500).send('Failed to start the games.');
    }
  } else {
    res.status(200).send();
  }
});

slackEvents.on('message', async (event) => {
  if (event.subtype && event.subtype === 'bot_message') {
    return;
  }

  const session = sessions[event.channelId];

  if (session && !session.solved) {
    session.conversationHistory = session.conversationHistory || [];
    session.conversationHistory.push({ role: "user", content: event.text });

    const messages = [
      { role: "system", content: customizationPrompt },
      { role: "user", content: `Here is the puzzle: ${session.puzzle.prompt}` },
      { role: "user", content: `The detailed answer to the puzzle is: ${session.puzzle.answer}` },
    ];

    session.conversationHistory.forEach(message => messages.push(message));

    try {
      const gptResponse = await openai.createChatCompletion({
        model: "gpt-4o",
        messages,
        max_tokens: 150,
      });

      const gptMessage = gptResponse.data.choices[0].message.content;
      session.conversationHistory.push({ role: "assistant", content: gptMessage });

      await webClient.chat.postMessage({
        channel: event.channel,
        text: gptMessage,
      });

      if (gptMessage.toLowerCase().includes('solved')) {
        session.solved = true;
        await webClient.chat.postMessage({
          channel: event.channel,
          text: "Congratulations! You've solved the puzzle! Would you like to play another round? Reply with 'yes' to start a new puzzle."
        });
      } else if (gptMessage.toLowerCase().includes('no')) {
        session.noCount++;
      } else {
        session.noCount = 0;
      }

      if (session.noCount === 5) {
        const hint = "Here's a hint to help you out: " + session.puzzle.answer.split('. ')[0] + ".";
        await webClient.chat.postMessage({
          channel: event.channel,
          text: hint,
        });
        session.noCount = 0;
      }

    } catch (error) {
      console.error(error);
    }
  } else if (session && session.solved && event.text.toLowerCase() === 'yes') {
    // Start a new puzzle round
    session.solved = false;
    session.noCount = 0;
    session.conversationHistory = [];

    try {
      const puzzleResponse = await openai.createChatCompletion({
        model: "gpt-4o",
        messages: [
          { role: "system", content: `${generatePuzzlePrompt} ${formatPrompt}` }
        ],
        max_tokens: 300,
      });

      const puzzle = puzzleResponse.data.choices[0].message.content;
      const [prompt, ...answerParts] = puzzle.split('Answer:');
      const answer = answerParts.join('Answer:').trim();

      session.puzzle = { prompt: prompt.trim(), answer };

      await webClient.chat.postMessage({
        channel: event.channel,
        text: `Here is your new puzzle: ${prompt.trim()}`
      });
    } catch (error) {
      console.error("Failed to generate new puzzle:", error);
    }
  }
});

app.post('/slack/events', (req, res) => {
  if (req.body && req.body.challenge) {
    res.status(200).send(req.body.challenge);
  } else {
    res.status(400).send('Invalid request');
  }
});

app.listen(port, () => {
  console.log(`Bot is running on port ${port}`);
});


module.exports.handler = serverlessExpress({ app });
