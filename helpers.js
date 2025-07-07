const axios = require("axios");

const generationBody = {
  model: "gpt-4.1-2025-04-14",
  messages: [
    {
      role: "system",
      content:
        "Generate a creative, interesting, engaging, but not too complex or lengthy situation puzzle. The puzzle prompt should be less than 120 characters. Provide a prompt and a detailed answer. Please provide the output in the following format: 'Prompt: <puzzle prompt> \n Answer: <detailed answer>'.",
    },
  ],
  max_tokens: 500,
};

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

// Function to find a user ID by username
const findUserId = async (username, client) => {
  try {
    const response = await client.users.list();
    const users = response.members;

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

const createGames = async (group, client, sessions) => {
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
    const puzzleResponse = await postToGPT(generationBody);

    const puzzle = puzzleResponse.choices[0].message.content;
    const [prompt, ...answerParts] = puzzle.split("Answer:");
    const answer = answerParts.join("Answer:").trim();

    sessions[channelId] = {
      puzzle: { prompt: prompt.trim().slice(8), answer: answer.slice(8) },
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

module.exports = { postToGPT, findUserId, createGames, generationBody };
