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
    const usersList = [user_id, ...text.split('').map(user => user.replace('@', ''))];
    if (usersList.length < 3) {
      res.status(200).send('Please invite at least 2 other users for the game.');
      return;
    }

    try {
      // Create a new channel
      const channelName = `puzzle-game-${Date.now()}`;
      const createChannelResponse = await webClient.conversations.create({
        name: channelName,
        is_private: true,
      });

      const channelId = createChannelResponse.channel.id;

      // Invite users to the channel
      const inviteResponse = await webClient.conversations.invite({
        channel: channelId,
        users: usersList.join(',')
      });

      // Send initial puzzle and instructions to the channel
      await webClient.chat.postMessage({
        channel: channelId,
        text: `Welcome to the Situation Puzzle Game! Here's your puzzle: [Insert Puzzle Here]`
      });

      res.status(200).send('Game started successfully.');

    } catch (error) {
      console.error(error);
      res.status(500).send('Failed to start the game.');
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
