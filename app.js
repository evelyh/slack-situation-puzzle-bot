require("dotenv").config();
const { App, AwsLambdaReceiver } = require("@slack/bolt");
const fs = require("fs");
const axios = require("axios");

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Initialize Slack app
const app = new App({
  receiver: awsLambdaReceiver,
  token: process.env.SLACK_BOT_TOKEN,
});

const customizationPrompt = fs
  .readFileSync("./puzzle_prompt.txt", "utf-8")
  .replace(/\n/g, " ");

// Define the sessions object to store game sessions
const sessions = {};

// Function to make a raw POST request
const postToGPT = async (data) => {
  try {
    const response = await axios.post(
      "https://zensurance-hackathon-ai-foundry.cognitiveservices.azure.com/openai/deployments/Eve-Lei-GPT4.1-API-key-hackathon-2025-Summer/chat/completions?api-version=2025-01-01-preview",
      data,
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": `${process.env.GPT4O_API_KEY}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error making POST request:", error);
    throw error;
  }
};

// Event listener for the "start-puzzle" slash command
app.command("/start-puzzle", async ({ command, ack, respond, client }) => {
  try {
    // Acknowledge the command request
    await ack();

    const findUserId = async (username) => {
      try {
        // Call the users.list method
        const response = await client.users.list();
        const users = response.members;

        // Iterate through the list of users
        for (const user of users) {
          if (user.name === username) {
            return user.id;
          }
        }
        return null;
      } catch (error) {
        console.error(`Error fetching user ID: ${error}`);
        return null;
      }
    };

    const usersList = [
      ...command.text.split(" ").map((user) => user.replace("@", "")),
    ];
    const userIdList = [command.user_id];
    for (const user of usersList) {
      const userId = await findUserId(user);
      if (userId) {
        userIdList.push(userId);
      } else {
        console.warn(`User ${user} not found.`);
      }
    }
    const numberOfUsers = userIdList.length;

    if (numberOfUsers < 3) {
      await respond(
        "Please invite at least 2 other users along with yourself for a total of at least 3 participants."
      );
      return;
    }

    const createGames = async (group) => {
      const channelName = `puzzle-game-${Date.now()}`;
      const createChannelResponse = await client.conversations.create({
        name: channelName,
      });
      const channelId = createChannelResponse.channel.id;

      try {
        await client.conversations.invite({
          channel: channelId,
          users: group.join(","),
        });
      } catch (error) {
        console.error(`Failed to invite users to channel ${channelId}:`, error);
      }

      await client.chat.postMessage({
        channel: channelId,
        text: `Welcome to the Situation Puzzle Game!`,
      });

      try {
        const puzzleResponse = await postToGPT({
          model: "gpt-4.1-2025-04-14",
          messages: [
            {
              role: "system",
              content:
                "Generate a creative, engaging, but not too complex or lengthy situation puzzle. The puzzle prompt should be less than 120 characters. Provide a prompt and a detailed answer. Please provide the output in the following format: 'Prompt: <puzzle prompt> \n Answer: <detailed answer>'.",
            },
          ],
          max_tokens: 500,
        });

        const puzzle = puzzleResponse.choices[0].message.content;
        console.log("Generated puzzle:", puzzle);
        const [prompt, ...answerParts] = puzzle.split("Answer:");
        const answer = answerParts.join("Answer:").trim();

        sessions[channelId] = {
          puzzle: { prompt: prompt.trim(), answer },
          conversationHistory: [],
          noCount: 0,
          solved: false,
        };

        await client.chat.postMessage({
          channel: channelId,
          text: `Here is your puzzle: ${prompt.trim()}`,
        });
      } catch (error) {
        console.error("Failed to generate puzzle:", error);
      }
    };

    // Group users into batches of 3
    for (let i = 0; i < numberOfUsers; i += 3) {
      const group = userIdList.slice(i, i + 3);
      if (group.length === 1 && numberOfUsers > 4) {
        break;
      } else if (group.length < 3 && group.length > 1) {
        await createGames(group);
      } else if (group.length === 3) {
        await createGames(group);
      }
    }

    await respond("Games started successfully.");
  } catch (error) {
    console.error("Error handling /start-puzzle command:", error);
    await respond("Failed to start the games.");
  }
});

// Event listener for messages
app.message(async ({ message, say, client }) => {
  try {
    if (message.subtype && message.subtype === "bot_message") {
      return;
    }

    const session = sessions[message.channel];

    if (session && !session.solved) {
      session.conversationHistory = session.conversationHistory || [];
      session.conversationHistory.push({ role: "user", content: message.text });

      const messages = [
        { role: "system", content: customizationPrompt },
        {
          role: "user",
          content: `Here is the puzzle: ${session.puzzle.prompt}`,
        },
        {
          role: "user",
          content: `The detailed answer to the puzzle is: ${session.puzzle.answer}`,
        },
      ];

      session.conversationHistory.forEach((msg) => messages.push(msg));

      const gptResponse = await postToGPT({
        model: "gpt-4.1-2025-04-14",
        messages,
        max_tokens: 300,
      });

      const gptMessage = gptResponse.choices[0].message.content;
      session.conversationHistory.push({
        role: "assistant",
        content: gptMessage,
      });

      await say(gptMessage);

      if (gptMessage.toLowerCase().includes("solved")) {
        session.solved = true;
        await say(
          "Congratulations! You've solved the puzzle! Reply with 'yes' to start a new puzzle."
        );
      } else if (gptMessage.toLowerCase().includes("no")) {
        session.noCount++;
      } else {
        session.noCount = 0;
      }

      if (session.noCount === 5) {
        const hint =
          "Here's a hint to help you out: " +
          session.puzzle.answer.split(". ")[0] +
          ".";
        await say(hint);
        session.noCount = 0;
      }
    } else if (
      session &&
      session.solved &&
      message.text.toLowerCase() === "yes"
    ) {
      session.solved = false;
      session.noCount = 0;
      session.conversationHistory = [];

      const puzzleResponse = await postToGPT({
        model: "gpt-4.1-2025-04-14",
        messages: [
          {
            role: "system",
            content:
              "Generate a creative, engaging, but not too complex or lengthy situation puzzle. The puzzle prompt should be less than 120 characters. Provide a prompt and a detailed answer. Please provide the output in the following format: 'Prompt: <puzzle prompt> \n Answer: <detailed answer>'.",
          },
        ],
        max_tokens: 500,
      });

      const puzzle = puzzleResponse.choices[0].message.content;
      const [prompt, ...answerParts] = puzzle.split("Answer:");
      const answer = answerParts.join("Answer:").trim();

      session.puzzle = { prompt: prompt.trim(), answer };

      await say(`Here is your new puzzle: ${prompt.trim()}`);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    await say("Sorry, I encountered an error while processing your message.");
  }
});

// Start the app
module.exports.handler = async (event, context, callback) => {
  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};
