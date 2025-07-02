// index.js

const { WebClient, RTMClient } = require('@slack/web-api');
const { createEventAdapter } = require('@slack/events-api');
const express = require('express');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackToken = process.env.SLACK_BOT_TOKEN;
const gpt4oApiKey = process.env.GPT4O_API_KEY;

const app = express();
const port = process.env.PORT || 3000;

const slackEvents = createEventAdapter(slackSigningSecret);
const webClient = new WebClient(slackToken);
const rtmClient = new RTMClient(slackToken);

const configuration = new Configuration({
  apiKey: gpt4oApiKey,
});
const openai = new OpenAIApi(configuration);

app.use('/slack/events', slackEvents.expressMiddleware());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post('/slack/commands', async (req, res) => {
  const { command, text, user_id } = req.body;

  if (command === '/start_puzzle') {
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
      };

      // Group users into batches of 3
      for (let i = 0; i < numberOfUsers; i += 3) {
        const group = usersList.slice(i, i + 3);
        if (group.length === 1 && numberOfUsers > 4) {
          // If there’s an orphan user and the total number exceeds 4, include this user in the previous group
          break;
        } else if (group.length < 3 && group.length > 1) {
          // Create a new channel for the remainder users if more than 1 and less than 3
          await createGames(group);
        } else if (group.length === 3) {
          // Create a new channel for every batch of 3
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

  try {
    // Use GPT-4O to respond to messages in puzzle channels
    const gptResponse = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant in a situation puzzle game." },
        { role: "user", content: event.text }
      ],
      max_tokens: 150,
    });

    await webClient.chat.postMessage({
      channel: event.channel,
      text: gptResponse.data.choices[0].message.content,
    });
  } catch (error) {
    console.error(error);
  }
});

rtmClient.start();

app.listen(port, () => {
  console.log(`Bot is running on port ${port}`);
});
