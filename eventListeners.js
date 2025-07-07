const { postToGPT, findUserId, createGames, getAPuzzle } = require("./helpers");
const sessions = require("./sessions");

const setupEventListeners = (app, customizationPrompt) => {
  // Event listener for the "start-puzzle" slash command
  app.command("/start-puzzle", async ({ command, ack, respond, client }) => {
    try {
      await ack();

      const usersList = [
        ...command.text.split(" ").map((user) => user.replace("@", "")),
      ];
      const userIdList = [command.user_id];
      for (const user of usersList) {
        const userId = await findUserId(user, client);
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

      for (let i = 0; i < numberOfUsers; i += 3) {
        const group = userIdList.slice(i, i + 3);
        if (group.length === 1 && numberOfUsers > 4) {
          break;
        } else if (group.length < 3 && group.length > 1) {
          await createGames(group, client, sessions);
        } else if (group.length === 3) {
          await createGames(group, client, sessions);
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
    console.log("Received message:", message);
    console.log("All sessions:", sessions);
    try {
      if (message.subtype && message.subtype === "bot_message") {
        return;
      }

      const session = sessions[message.channel];
      console.log("Current session:", session);

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
        await getAPuzzle(client, message.channel, sessions);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      await say("Sorry, I encountered an error while processing your message.");
    }
  });
};

module.exports = setupEventListeners;
